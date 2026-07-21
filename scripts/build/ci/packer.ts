// Packer template generation for CI images (both platforms).
//
// Every CI image is baked by Packer, and its template is generated as JSON
// at bake time from the image's spec entry — base image, bake VM shape,
// destination — so there is no checked-in .pkr.hcl to drift. Facts come
// from the spec; the provisioner SEQUENCE is code and lives here.
//
// Linux (amazon-ebs): resolve the FLOATING base AMI glob (newest match),
// spot pricing, SSH shell provisioning: fetch the pinned node, run
// `node bootstrap.ts --image=<key> --ci --repo-ref=<ref>`, install the
// agent service, then Packer stops the VM and registers the AMI. Packer
// owns the temp keypair / security group / instance lifecycle, including
// cleanup on failure.
//
// Windows (azure-arm): VM create, WinRM provisioning: fetch node, run
// bootstrap.ts, install the agent service, reboot, then sysprep last, and
// publish to the Compute Gallery.
//
// Packer accepts JSON templates natively (packer build template.pkr.json).

import { nodejsDownload, nodejsFolderName } from "./artifacts.ts";
import { windowsAgentEntry } from "./components/paths.ts";
import { LINUX_REMOTE_ROOT, linuxBootstrapCommand } from "./delivery.ts";
import { packer } from "./spec.ts";
import type { LinuxImage, WindowsImage } from "./types.ts";

export type LinuxPackerTemplateInput = {
  image: LinuxImage;
  /** Exact AMI name (from naming.ts): `${key}-${hash}`. */
  imageName: string;
  /** Git ref the bootstrap clones for the prefetch caches. */
  repoRef: string;
  /** Local path of the directory holding bootstrap.ts + its modules
   * (uploaded to the VM under the delivery root). */
  bootstrapDir: string;
  /** Local path of the esbuild-bundled agent.mjs (uploaded to the VM). */
  agentPath: string;
  aws: {
    /** Region to bake in (a runtime/deployment fact, from EC2_REGION). */
    region: string;
  };
};

/**
 * The complete Packer JSON template for one Linux image bake (amazon-ebs).
 * The base AMI is resolved by Packer at bake time from the spec's owner +
 * name glob (source_ami_filter, newest wins) — the same FLOATING lookup the
 * spec describes, done by Packer instead of by hand.
 */
export function linuxPackerTemplate(input: LinuxPackerTemplateInput): Record<string, unknown> {
  const { image, imageName, repoRef, bootstrapDir, agentPath, aws } = input;
  const { base, bake } = image;

  const source: Record<string, unknown> = {
    region: aws.region,
    // Resolve the newest AMI matching the spec's glob from its owner — the
    // FLOATING base image, exactly as the spec describes it.
    source_ami_filter: {
      filters: {
        name: base.nameGlob,
        "root-device-type": "ebs",
        "virtualization-type": "hvm",
      },
      owners: [base.owner],
      most_recent: true,
    },
    ami_name: imageName,
    // Spot for the bake VM (a fraction of on-demand). "auto" tracks the
    // current price; the bake tolerates interruption by simply failing the
    // step, which the next push retries.
    spot_price: "auto",
    instance_type: bake.instanceType,
    ssh_username: base.sshUsername,
    // Root volume sized for the bake (toolchains, caches); the AMI keeps it.
    launch_block_device_mappings: [
      {
        device_name: "/dev/xvda",
        volume_size: bake.diskSizeGb,
        volume_type: "gp3",
        delete_on_termination: true,
      },
    ],
    ami_description: `Bun CI image ${imageName} (baked from scripts/build/ci)`,
    tags: {
      Name: imageName,
      os: "linux",
      arch: image.arch,
      distro: image.distro,
      "image-name": imageName,
    },
    // Robobun launches runners from this AMI by name.
    snapshot_tags: { Name: imageName },
  };

  return {
    packer: {
      required_plugins: {
        amazon: {
          source: "github.com/hashicorp/amazon",
          version: `>= ${packer.amazonPluginVersion}`,
        },
      },
    },
    source: { "amazon-ebs": { linux: source } },
    build: {
      sources: ["source.amazon-ebs.linux"],
      provisioner: hclProvisioners([
        // Step 1: upload the bootstrap sources into the delivery root.
        {
          type: "file",
          source: `${bootstrapDir}/`,
          destination: LINUX_REMOTE_ROOT,
        },
        // Step 2: fetch the pinned node and run bootstrap.ts. The delivery
        // shim carries no facts — it reads them from the image entry.
        {
          type: "shell",
          inline: [linuxBootstrapCommand(image, { ci: true, repoRef })],
        },
        // Step 3: upload the bundled agent and install it as a service so
        // the runner registers on boot (agent.mjs `install` registers itself
        // and reads its config from EC2 tags).
        {
          type: "file",
          source: agentPath,
          destination: `${LINUX_REMOTE_ROOT}/agent.mjs`,
        },
        {
          type: "shell",
          inline: [`sudo -n -- node ${LINUX_REMOTE_ROOT}/agent.mjs install`],
        },
      ]),
    },
  };
}

export type PackerTemplateInput = {
  image: WindowsImage;
  /** Exact gallery image definition name (from naming.ts). */
  imageName: string;
  /** Git ref the bootstrap clones for the prefetch caches. */
  repoRef: string;
  /** Local path of the directory holding bootstrap.ts + its modules
   * (uploaded to the VM). */
  bootstrapDir: string;
  /** Local path of the esbuild-bundled agent.mjs (uploaded to the VM). */
  agentPath: string;
  azure: {
    clientId: string;
    clientSecret: string;
    subscriptionId: string;
    tenantId: string;
    /** Where Packer creates its temporary build resources. Kept separate
     * so its 4-core bake VMs don't contend with CI runners for quota. */
    buildResourceGroup: string;
    location: string;
  };
};

/** Where the bootstrap sources land on the bake VM (deleted by sysprep). */
const REMOTE_BOOTSTRAP_DIR = "C:\\bun-bootstrap";
/** The pinned node is unpacked inside the bootstrap dir so one cleanup
 * removes both. */
const REMOTE_NODE_DIR = `${REMOTE_BOOTSTRAP_DIR}\\node`;

/**
 * The complete Packer JSON template for one Windows image bake.
 * Returned as an object; the caller writes it with JSON.stringify.
 */
export function windowsPackerTemplate(input: PackerTemplateInput): Record<string, unknown> {
  const { image, imageName, repoRef, bootstrapDir, agentPath, azure } = input;
  const { gallery } = image;
  const node = nodejsDownload(image.nodejs, "windows", image.arch, null);
  const nodeFolder = nodejsFolderName(image.nodejs, "windows", image.arch, null);

  const source: Record<string, unknown> = {
    client_id: azure.clientId,
    client_secret: azure.clientSecret,
    subscription_id: azure.subscriptionId,
    tenant_id: azure.tenantId,
    // Source: the FLOATING marketplace base for this image entry.
    os_type: "Windows",
    image_publisher: image.base.publisher,
    image_offer: image.base.offer,
    image_sku: image.base.sku,
    image_version: image.base.version,
    // Bake VM. Only used during image creation, not for CI runners
    // (runner VM sizes are set in ci.mjs).
    vm_size: image.bake.vmSize,
    os_disk_size_gb: image.bake.diskSizeGb,
    // Use the dedicated build resource group instead of a temp one.
    build_resource_group_name: azure.buildResourceGroup,
    // Security: TrustedLaunch matches the gallery image definition.
    security_type: "TrustedLaunch",
    secure_boot_enabled: true,
    vtpm_enabled: true,
    // Networking: Packer creates a temp VNet + public IP + NSG; WinRM
    // connects over the public IP.
    communicator: "winrm",
    winrm_use_ssl: true,
    winrm_insecure: true,
    winrm_timeout: "15m",
    winrm_username: "packer",
    // Replication to 27 regions outlasts the 60m default (the
    // CreateOrUpdate poll hit "context deadline exceeded" at exactly 1h).
    shared_image_gallery_timeout: "3h",
    // Publish to the Compute Gallery. Premium_LRS: SSD-backed gallery
    // storage — faster provisioning when robobun launches runners from
    // this image, and faster cross-region replication.
    shared_image_gallery_destination: {
      subscription: azure.subscriptionId,
      resource_group: gallery.resourceGroup,
      gallery_name: gallery.name,
      image_name: imageName,
      image_version: gallery.imageVersion,
      storage_account_type: gallery.storageAccountType,
      // A VM in region X needs a replica in X; the list mirrors robobun's
      // spot-capacity region fallback (see spec.ts).
      target_region: gallery.replicationRegions.map(region => ({ name: region ?? azure.location })),
    },
    azure_tags: {
      os: "windows",
      arch: image.arch,
      "image-name": imageName,
    },
  };
  // ARM64 has no managed-image support; x64 skips it too since the gallery
  // is the only artifact anything reads.

  const bootstrapCommand = [
    `& '${REMOTE_NODE_DIR}\\${nodeFolder}\\node.exe' '${REMOTE_BOOTSTRAP_DIR}\\scripts\\build\\ci\\bootstrap.ts'`,
    `--image=${image.key}`,
    "--ci",
    `--repo-ref=${repoRef}`,
  ].join(" ");

  return {
    packer: {
      required_plugins: {
        azure: {
          source: "github.com/hashicorp/azure",
          version: `= ${packer.azurePluginVersion}`,
        },
      },
    },
    source: { "azure-arm": { windows: source } },
    build: {
      sources: ["source.azure-arm.windows"],
      // Provisioners are HCL labeled blocks (`provisioner "file" { ... }`);
      // in JSON template mode the label is the object KEY wrapping the body,
      // not a "type" field. hclProvisioners() re-shapes the readable
      // {type, ...body} entries below into that encoding.
      provisioner: hclProvisioners([
        // Step 1: upload the bootstrap sources (spec + bootstrap modules).
        {
          type: "file",
          source: `${bootstrapDir}/`,
          destination: `${REMOTE_BOOTSTRAP_DIR}\\`,
        },
        // Step 2: fetch the spec-pinned node (the same node the image
        // keeps) so bootstrap.ts runs under a real node with type-stripping.
        {
          type: "powershell",
          inline: [
            `Write-Output '>>> Downloading node from ${node.url}'`,
            `New-Item -ItemType Directory -Force -Path '${REMOTE_NODE_DIR}' | Out-Null`,
            `$zip = Join-Path $env:TEMP 'node.zip'`,
            `Invoke-WebRequest -Uri '${node.url}' -OutFile $zip -UseBasicParsing`,
            `Expand-Archive -Path $zip -DestinationPath '${REMOTE_NODE_DIR}' -Force`,
            `& '${REMOTE_NODE_DIR}\\${nodeFolder}\\node.exe' --version`,
          ],
          valid_exit_codes: [0],
        },
        // Step 3: run the bootstrap. It installs everything the spec entry
        // lists (Scoop packages, VS Build Tools, SDE, ...). 3010 = "reboot
        // required" from the VS installer, not a failure.
        {
          type: "powershell",
          inline: [`Write-Output '>>> Running bootstrap: ${bootstrapCommand.replace(/'/g, "''")}'`, bootstrapCommand],
          valid_exit_codes: [0, 3010],
        },
        // Step 4: upload the bundled agent to its spec path and install it as
        // an nssm service (agent.mjs `install` registers itself).
        {
          type: "file",
          source: agentPath,
          destination: windowsAgentEntry(image),
        },
        {
          type: "powershell",
          inline: [`${image.paths.node} ${windowsAgentEntry(image)} install`],
          valid_exit_codes: [0],
        },
        // Step 5: reboot to clear pending updates (VS Build Tools, Windows
        // Update), then sysprep — sysprep MUST be the last provisioner.
        {
          type: "windows-restart",
          restart_timeout: "10m",
        },
        // Sysprep sequence, inline as the final provisioner. Clears the
        // pending-reboot markers that make sysprep bail, waits for the Azure
        // guest agents (sysprep needs them running), then generalizes and
        // polls until the image state confirms the reseal — with a timeout
        // that dumps the sysprep log instead of hanging the bake.
        {
          type: "powershell",
          inline: [
            `Remove-Item -Recurse -Force ${REMOTE_BOOTSTRAP_DIR} -ErrorAction SilentlyContinue`,
            "Remove-Item -Recurse -Force C:\\Windows\\Panther -ErrorAction SilentlyContinue",
            "Write-Output '>>> Clearing pending reboot flags...'",
            "Remove-Item 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending' -Recurse -Force -ErrorAction SilentlyContinue",
            "Remove-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update' -Name 'RebootRequired' -Force -ErrorAction SilentlyContinue",
            "Remove-Item 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired' -Recurse -Force -ErrorAction SilentlyContinue",
            "Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name 'PendingFileRenameOperations' -Force -ErrorAction SilentlyContinue",
            "Write-Output '>>> Waiting for Azure Guest Agent...'",
            "while ((Get-Service RdAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
            "while ((Get-Service WindowsAzureGuestAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
            "Write-Output '>>> Running Sysprep...'",
            "$global:LASTEXITCODE = 0",
            "& $env:SystemRoot\\System32\\Sysprep\\Sysprep.exe /oobe /generalize /quiet /quit /mode:vm",
            "$timeout = 300; $elapsed = 0",
            "while ($true) {",
            "  $imageState = (Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Setup\\State).ImageState",
            '  Write-Output "ImageState: $imageState ($($elapsed)s)"',
            "  if ($imageState -eq 'IMAGE_STATE_GENERALIZE_RESEAL_TO_OOBE') { break }",
            "  if ($elapsed -ge $timeout) {",
            '    Write-Error "Timed out after $($timeout)s -- stuck at $imageState"',
            '    Get-Content "$env:SystemRoot\\System32\\Sysprep\\Panther\\setupact.log" -Tail 100 -ErrorAction SilentlyContinue',
            "    exit 1",
            "  }",
            "  Start-Sleep -s 10",
            "  $elapsed += 10",
            "}",
            "Write-Output '>>> Sysprep complete.'",
          ],
        },
      ]),
    },
  };
}

/**
 * Encode provisioners for Packer's JSON template mode. HCL block
 * `provisioner "TYPE" { body }` is written as `{ "TYPE": { body } }` — the
 * label is the wrapping key. Each entry here is authored as
 * `{ type, ...body }` for readability and re-shaped into that form.
 */
function hclProvisioners(
  provisioners: readonly ({ type: string } & Record<string, unknown>)[],
): Record<string, unknown>[] {
  return provisioners.map(provisioner => {
    const { type, ...body } = provisioner;
    return { [type]: body };
  });
}

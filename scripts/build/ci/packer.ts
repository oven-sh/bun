// Packer template generation for Windows CI images.
//
// Windows images are baked with Packer's azure-arm builder (VM create,
// WinRM provisioning, sysprep, gallery capture). The template is generated
// as JSON at bake time from the image's spec entry — the base image, bake VM
// size, disk, gallery destination, and the 27 replication regions are all
// facts on WindowsImage — so there is no checked-in .pkr.hcl to drift.
//
// The provisioner sequence is code, and lives here:
//   1. download the pinned node, upload the bootstrap sources
//   2. run `node bootstrap.ts --image=<key> --ci --repo-ref=<ref>`
//   3. upload agent.mjs and install it as a service
//   4. reboot (VS Build Tools / Windows Update leftovers), then sysprep last
//
// Packer accepts JSON templates natively (packer build template.pkr.json).

import { nodejsDownload, nodejsFolderName } from "./artifacts.ts";
import { windowsAgentEntry } from "./components/paths.ts";
import type { WindowsImage } from "./types.ts";

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
    /** The gallery's resource group (also where robobun launches VMs). */
    resourceGroup: string;
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
          version: `= ${gallery.packerAzurePluginVersion}`,
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

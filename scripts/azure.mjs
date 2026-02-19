// Azure REST API client for machine.mjs
// Used by the [build images] pipeline to create Windows VM images (x64 and ARM64)

import { getSecret, isCI } from "./utils.mjs";

/**
 * @typedef {Object} AzureConfig
 * @property {string} tenantId
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} subscriptionId
 * @property {string} resourceGroup
 * @property {string} location
 * @property {string} galleryName
 */

/** @returns {AzureConfig} */
function getConfig() {
  const env = (name, fallback) => {
    if (isCI) {
      try {
        return getSecret(name, { required: !fallback }) || fallback;
      } catch {
        if (fallback) return fallback;
        throw new Error(`Azure secret not found: ${name}`);
      }
    }
    return process.env[name] || fallback;
  };

  return {
    tenantId: env("AZURE_TENANT_ID"),
    clientId: env("AZURE_CLIENT_ID"),
    clientSecret: env("AZURE_CLIENT_SECRET"),
    subscriptionId: env("AZURE_SUBSCRIPTION_ID"),
    resourceGroup: env("AZURE_RESOURCE_GROUP", "BUN-CI"),
    location: env("AZURE_LOCATION", "eastus2"),
    galleryName: env("AZURE_GALLERY_NAME", "bunCIGallery2"),
  };
}

let _config;
function config() {
  return (_config ??= getConfig());
}

// ============================================================================
// Authentication
// ============================================================================

let _accessToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 300_000) {
    return _accessToken;
  }

  const { tenantId, clientId, clientSecret } = config();
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    }),
  });

  if (!response.ok) {
    throw new Error(`[azure] Auth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + data.expires_in * 1000;
  return _accessToken;
}

// ============================================================================
// REST Client
// ============================================================================

/**
 * @param {"GET"|"PUT"|"POST"|"PATCH"|"DELETE"} method
 * @param {string} path - Relative path under management.azure.com, or absolute URL
 * @param {object} [body]
 * @param {string} [apiVersion]
 */
async function azureFetch(method, path, body, apiVersion = "2024-07-01") {
  const token = await getAccessToken();

  const url = path.startsWith("http") ? new URL(path) : new URL(`https://management.azure.com${path}`);

  if (!url.searchParams.has("api-version")) {
    url.searchParams.set("api-version", apiVersion);
  }

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body && method !== "GET" && method !== "DELETE") {
    options.body = JSON.stringify(body);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429 || response.status >= 500) {
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(`[azure] ${method} ${path} returned ${response.status}, retrying in ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    // 202 Accepted — async operation, poll for completion
    if (response.status === 202) {
      const operationUrl = response.headers.get("Azure-AsyncOperation") || response.headers.get("Location");
      if (operationUrl) {
        return waitForOperation(operationUrl);
      }
    }

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[azure] ${method} ${path} failed: ${response.status} ${text}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  throw new Error(`[azure] ${method} ${path} failed after 3 retries`);
}

async function waitForOperation(operationUrl, maxWaitMs = 3_600_000) {
  const start = Date.now();
  let fetchErrors = 0;

  while (Date.now() - start < maxWaitMs) {
    const token = await getAccessToken();

    let response;
    try {
      response = await fetch(operationUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      fetchErrors++;
      if (fetchErrors > 10) {
        throw new Error(`[azure] Operation poll failed after ${fetchErrors} fetch errors`, { cause: err });
      }
      console.warn(`[azure] Operation poll fetch error (${fetchErrors}), retrying...`);
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }

    if (!response.ok) {
      throw new Error(`[azure] Operation poll failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();

    if (data.status === "Succeeded") {
      return data.properties?.output ?? data;
    }
    if (data.status === "Failed" || data.status === "Canceled") {
      throw new Error(`[azure] Operation ${data.status}: ${data.error?.message ?? "unknown"}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  throw new Error(`[azure] Operation timed out after ${maxWaitMs}ms`);
}

// ============================================================================
// Resource helpers
// ============================================================================

function rgPath() {
  const { subscriptionId, resourceGroup } = config();
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
}

// ============================================================================
// Public IP
// ============================================================================

async function createPublicIp(name) {
  const { location } = config();
  console.log(`[azure] Creating public IP: ${name}`);
  const result = await azureFetch("PUT", `${rgPath()}/providers/Microsoft.Network/publicIPAddresses/${name}`, {
    location,
    sku: { name: "Standard" },
    properties: {
      publicIPAllocationMethod: "Static",
      deleteOption: "Delete",
    },
  });
  return result?.properties?.ipAddress;
}

async function deletePublicIp(name) {
  await azureFetch("DELETE", `${rgPath()}/providers/Microsoft.Network/publicIPAddresses/${name}`).catch(() => {});
}

// ============================================================================
// Network Security Group
// ============================================================================

// ============================================================================
// Network Interface
// ============================================================================

async function createNic(name, publicIpName, subnetId, nsgId) {
  const { location } = config();
  console.log(`[azure] Creating NIC: ${name}`);
  const publicIpId = `${rgPath()}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`;
  await azureFetch("PUT", `${rgPath()}/providers/Microsoft.Network/networkInterfaces/${name}`, {
    location,
    properties: {
      ipConfigurations: [
        {
          name: "ipconfig1",
          properties: {
            privateIPAllocationMethod: "Dynamic",
            publicIPAddress: { id: publicIpId, properties: { deleteOption: "Delete" } },
            subnet: { id: subnetId },
          },
        },
      ],
      ...(nsgId ? { networkSecurityGroup: { id: nsgId } } : {}),
    },
  });
  return `${rgPath()}/providers/Microsoft.Network/networkInterfaces/${name}`;
}

async function deleteNic(name) {
  await azureFetch("DELETE", `${rgPath()}/providers/Microsoft.Network/networkInterfaces/${name}`).catch(() => {});
}

// ============================================================================
// Virtual Machines
// ============================================================================

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.vmSize
 * @param {object} opts.imageReference
 * @param {number} opts.osDiskSizeGB
 * @param {string} opts.nicId
 * @param {string} opts.adminUsername
 * @param {string} opts.adminPassword
 * @param {Record<string, string>} [opts.tags]
 */
async function createVm(opts) {
  const { location } = config();
  console.log(`[azure] Creating VM: ${opts.name} (${opts.vmSize})`);
  const result = await azureFetch("PUT", `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${opts.name}`, {
    location,
    tags: opts.tags,
    properties: {
      hardwareProfile: { vmSize: opts.vmSize },
      storageProfile: {
        imageReference: opts.imageReference,
        osDisk: {
          createOption: "FromImage",
          diskSizeGB: opts.osDiskSizeGB,
          deleteOption: "Delete",
          managedDisk: { storageAccountType: "Premium_LRS" },
        },
      },
      osProfile: {
        computerName: opts.name.substring(0, 15),
        adminUsername: opts.adminUsername,
        adminPassword: opts.adminPassword,
      },
      securityProfile: {
        securityType: "TrustedLaunch",
      },
      networkProfile: {
        networkInterfaces: [{ id: opts.nicId, properties: { deleteOption: "Delete" } }],
      },
    },
  });
  return result;
}

async function getVm(name) {
  try {
    return await azureFetch(
      "GET",
      `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${name}?$expand=instanceView`,
    );
  } catch {
    return null;
  }
}

async function getVmPowerState(name) {
  const vm = await getVm(name);
  const statuses = vm?.properties?.instanceView?.statuses ?? [];
  const powerStatus = statuses.find(s => s.code?.startsWith("PowerState/"));
  return powerStatus?.code;
}

async function stopVm(name) {
  console.log(`[azure] Stopping VM: ${name}`);
  await azureFetch("POST", `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${name}/deallocate`);
}

async function generalizeVm(name) {
  console.log(`[azure] Generalizing VM: ${name}`);
  await azureFetch("POST", `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${name}/generalize`);
}

async function deleteVm(name) {
  console.log(`[azure] Deleting VM: ${name}`);
  await azureFetch("DELETE", `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${name}?forceDeletion=true`);
}

async function getPublicIpAddress(publicIpName) {
  const result = await azureFetch("GET", `${rgPath()}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`);
  return result?.properties?.ipAddress;
}

/**
 * Run a PowerShell script on a Windows VM via Azure Run Command.
 * This works even without SSH installed on the VM.
 */
async function runCommand(vmName, script) {
  console.log(`[azure] Running command on VM: ${vmName}`);
  return azureFetch("POST", `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${vmName}/runCommand`, {
    commandId: "RunPowerShellScript",
    script: Array.isArray(script) ? script : [script],
  });
}

/**
 * Install OpenSSH server and configure authorized keys on a Windows VM.
 */
// SSH is not used — all remote operations go through Azure Run Command API.

// ============================================================================
// Virtual Network
// ============================================================================

// ============================================================================
// Compute Gallery
// ============================================================================

const GALLERY_API_VERSION = "2024-03-03";

async function ensureImageDefinition(name, os, arch) {
  const { location, galleryName } = config();
  const path = `${rgPath()}/providers/Microsoft.Compute/galleries/${galleryName}/images/${name}`;

  try {
    const def = await azureFetch("GET", path, undefined, GALLERY_API_VERSION);
    if (def) return;
  } catch {}

  console.log(`[azure] Creating image definition: ${name}`);
  await azureFetch(
    "PUT",
    path,
    {
      location,
      properties: {
        osType: os === "windows" ? "Windows" : "Linux",
        osState: "Generalized",
        hyperVGeneration: "V2",
        architecture: arch === "aarch64" ? "Arm64" : "x64",
        identifier: {
          publisher: "bun",
          offer: `${os}-${arch}-ci`,
          sku: name,
        },
        features: [
          { name: "DiskControllerTypes", value: "SCSI, NVMe" },
          { name: "SecurityType", value: "TrustedLaunch" },
        ],
      },
    },
    GALLERY_API_VERSION,
  );
}

async function createImageVersion(imageDefName, version, vmId) {
  const { location, galleryName } = config();
  const path = `${rgPath()}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefName}/versions/${version}`;

  console.log(`[azure] Creating image version: ${imageDefName}/${version}`);
  const result = await azureFetch(
    "PUT",
    path,
    {
      location,
      properties: {
        storageProfile: {
          source: { virtualMachineId: vmId },
        },
      },
    },
    GALLERY_API_VERSION,
  );
  return result;
}

// ============================================================================
// Base Images
// ============================================================================

function getBaseImageReference(os, arch) {
  if (os === "windows") {
    if (arch === "aarch64") {
      return {
        publisher: "MicrosoftWindowsDesktop",
        offer: "windows11preview-arm64",
        sku: "win11-24h2-pro",
        version: "latest",
      };
    }
    // Windows Server 2019 x64 — oldest supported version
    return {
      publisher: "MicrosoftWindowsServer",
      offer: "WindowsServer",
      sku: "2019-datacenter-gensecond",
      version: "latest",
    };
  }
  throw new Error(`[azure] Unsupported OS: ${os}`);
}

function getVmSize(arch) {
  return arch === "aarch64" ? "Standard_D4ps_v6" : "Standard_D4ds_v6";
}

// ============================================================================
// Exports
// ============================================================================

export const azure = {
  get name() {
    return "azure";
  },

  config,

  /**
   * @param {import("./machine.mjs").MachineOptions} options
   * @returns {Promise<import("./machine.mjs").Machine>}
   */
  async createMachine(options) {
    const { os, arch, tags, sshKeys } = options;
    const vmName = `bun-${os}-${arch}-${Date.now()}`;
    const publicIpName = `${vmName}-ip`;
    const nicName = `${vmName}-nic`;
    const vmSize = options.instanceType || getVmSize(arch);
    const diskSizeGB = options.diskSizeGb || (os === "windows" ? 150 : 40);

    // Generate a random password for the admin account
    const adminPassword = `P@${crypto.randomUUID().replace(/-/g, "").substring(0, 20)}!`;

    const subnetId = `${rgPath()}/providers/Microsoft.Network/virtualNetworks/bun-ci-vnet/subnets/default`;
    const nsgId = `${rgPath()}/providers/Microsoft.Network/networkSecurityGroups/bun-ci-ssh-nsg`;

    await createPublicIp(publicIpName);
    const nicId = await createNic(nicName, publicIpName, subnetId, nsgId);

    // Create VM
    const imageReference = options.imageId ? { id: options.imageId } : getBaseImageReference(os, arch);

    await createVm({
      name: vmName,
      vmSize,
      imageReference,
      osDiskSizeGB: diskSizeGB,
      nicId,
      adminUsername: "bunadmin",
      adminPassword,
      tags: tags
        ? Object.fromEntries(
            Object.entries(tags)
              .filter(([_, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          )
        : undefined,
    });

    // Wait for public IP to be assigned
    let publicIp;
    for (let i = 0; i < 30; i++) {
      publicIp = await getPublicIpAddress(publicIpName);
      if (publicIp) break;
      await new Promise(r => setTimeout(r, 5000));
    }

    if (!publicIp) {
      throw new Error(`[azure] Failed to get public IP for ${vmName}`);
    }

    console.log(`[azure] VM created: ${vmName} at ${publicIp}`);

    // Use Azure Run Command for all remote operations instead of SSH.
    // This avoids the sshd startup issues on Azure Windows VMs.

    const spawnFn = async (command, opts) => {
      const script = command.join(" ");
      console.log(`[azure] Run: ${script}`);
      // Note: Azure Run Command output is limited to the last 4096 bytes.
      // Full output is not available — only the tail is returned.
      // value[0] = stdout (ComponentStatus/StdOut), value[1] = stderr (ComponentStatus/StdErr)
      const result = await runCommand(vmName, [script]);
      const values = result?.value ?? [];
      const stdout = values[0]?.message ?? "";
      const stderr = values[1]?.message ?? "";
      if (opts?.stdio === "inherit") {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
      }
      // Only use displayStatus to detect errors — stderr often contains non-error
      // output (rustup progress, cargo warnings, PowerShell Write-Warning, etc.)
      const hasError = values.some(v => v?.displayStatus === "Provisioning failed");
      const exitCode = hasError ? 1 : 0;
      return { exitCode, stdout, stderr };
    };

    const spawnSafeFn = async (command, opts) => {
      const result = await spawnFn(command, opts);
      if (result.exitCode !== 0) {
        const msg = result.stderr || result.stdout || "Unknown error";
        throw new Error(`[azure] Command failed (exit ${result.exitCode}): ${command.join(" ")}\n${msg}`);
      }
      return result;
    };
    const upload = async (source, destination) => {
      // Read the file locally and write it on the VM via Run Command
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(source, "utf-8");
      // Escape for PowerShell — use base64 to avoid escaping issues
      const b64 = Buffer.from(content).toString("base64");
      const script = [
        `$bytes = [Convert]::FromBase64String('${b64}')`,
        `$dir = Split-Path '${destination}' -Parent`,
        `if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }`,
        `[IO.File]::WriteAllBytes('${destination}', $bytes)`,
        `Write-Host "Uploaded to ${destination} ($($bytes.Length) bytes)"`,
      ];
      console.log(`[azure] Uploading ${source} -> ${destination}`);
      await runCommand(vmName, script);
    };

    const attach = async () => {
      console.log(`[azure] Attach not supported via Run Command (VM: ${vmName}, IP: ${publicIp})`);
    };

    const waitForSsh = async () => {
      // No SSH needed — Run Command works immediately after VM is provisioned
      // Just verify the VM is responsive
      console.log(`[azure] Verifying VM is responsive...`);
      await runCommand(vmName, ["Write-Host 'VM is ready'"]);
      console.log(`[azure] VM is responsive`);
    };

    const snapshot = async label => {
      const vmId = `${rgPath()}/providers/Microsoft.Compute/virtualMachines/${vmName}`;

      // Run sysprep inside the VM before deallocating.
      // This prepares Windows for generalization so the gallery image
      // can be used to create new VMs with OS provisioning.
      console.log(`[azure] Running sysprep on ${vmName}...`);
      await runCommand(vmName, ["C:\\Windows\\System32\\Sysprep\\sysprep.exe /generalize /oobe /shutdown /quiet"]);

      // Wait for VM to shut down after sysprep (sysprep triggers shutdown)
      for (let i = 0; i < 60; i++) {
        const state = await getVmPowerState(vmName);
        if (state === "PowerState/stopped" || state === "PowerState/deallocated") break;
        await new Promise(r => setTimeout(r, 10000));
      }

      // Deallocate the VM
      await stopVm(vmName);
      // Wait for VM to be deallocated
      for (let i = 0; i < 60; i++) {
        const state = await getVmPowerState(vmName);
        if (state === "PowerState/deallocated") break;
        await new Promise(r => setTimeout(r, 5000));
      }

      await generalizeVm(vmName);

      // Ensure gallery and image definition exist.
      // Use the label as the image definition name — this matches what ci.mjs
      // emits as the image-name agent tag, so robobun can look it up directly.
      const imageDefName = label;
      await ensureImageDefinition(imageDefName, os, arch);

      // Create a single version "1.0.0" under this definition.
      await createImageVersion(imageDefName, "1.0.0", vmId);

      // Wait for image replication to complete before returning.
      // Single-region replication typically takes 5-15 minutes.
      const { galleryName } = config();
      const versionPath = `${rgPath()}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefName}/versions/1.0.0`;
      console.log(`[azure] Waiting for image replication...`);
      for (let i = 0; i < 120; i++) {
        const ver = await azureFetch("GET", versionPath, undefined, GALLERY_API_VERSION);
        const state = ver?.properties?.provisioningState;
        if (state === "Succeeded") {
          console.log(`[azure] Image ready: ${imageDefName}/1.0.0`);
          break;
        }
        if (state === "Failed") {
          throw new Error(`[azure] Image replication failed: ${JSON.stringify(ver?.properties)}`);
        }
        if (i % 6 === 0) {
          console.log(`[azure] Image replicating... (${i}m elapsed)`);
        }
        await new Promise(r => setTimeout(r, 10_000));
      }

      return label;
    };

    const terminate = async () => {
      await deleteVm(vmName);
      // Resources with deleteOption=Delete are cleaned up automatically
      // But clean up anything that might be left
      await deleteNic(nicName);
      await deletePublicIp(publicIpName);
    };

    return {
      cloud: "azure",
      id: vmName,
      imageId: options.imageId,
      instanceType: vmSize,
      region: config().location,
      get publicIp() {
        return publicIp;
      },
      spawn: spawnFn,
      spawnSafe: spawnSafeFn,
      upload,
      attach,
      snapshot,
      waitForSsh,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },
};

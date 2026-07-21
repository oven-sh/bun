import { spawn as nodeSpawn } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { azure } from "./azure.mjs";
import { packerDownload } from "./build/ci/artifacts.ts";
import { BOOTSTRAP_SOURCE_DIRS, LINUX_REMOTE_ROOT } from "./build/ci/delivery.ts";
import { imageName as computeImageName, imageEntry } from "./build/ci/naming.ts";
import { linuxPackerTemplate, windowsPackerTemplate } from "./build/ci/packer.ts";
import { packer } from "./build/ci/spec.ts";
import { docker } from "./docker.mjs";
import { tart } from "./tart.mjs";
import {
  $,
  copyFile,
  getBranch,
  getSecret,
  isCI,
  mkdtemp,
  rm,
  spawn,
  spawnSafe,
  spawnSyncSafe,
  waitForPort,
  which,
} from "./utils.mjs";

/**
 * The AWS client the CI entry point still needs: a describe-images lookup
 * for the by-name idempotency check before a bake. Baking itself is done
 * by Packer's amazon-ebs builder, which owns the instance/keypair/AMI
 * lifecycle.
 */
const aws = {
  get name() {
    return "aws";
  },

  /**
   * @param {string[]} args
   * @param {import("./utils.mjs").SpawnOptions} [options]
   * @returns {Promise<unknown>}
   */
  async spawn(args, options = {}) {
    const aws = which("aws");
    if (!aws) {
      throw new Error("Command not found: aws");
    }

    let env;
    if (isCI) {
      env = {
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID"),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY"),
        AWS_REGION: getSecret("EC2_REGION", { required: false }) || "us-east-1",
      };
    }

    const { stdout } = await spawnSafe($`${aws} ${args} --output json`, { env, ...options });
    try {
      return JSON.parse(stdout);
    } catch {
      return;
    }
  },

  /**
   * @param {{ state?: string; name?: string }} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-images.html
   */
  async describeImages(options = {}) {
    // Each `Name=…,Values=…` is its own argv element after one --filters
    // (the $ tag spreads an array into separate arguments; a joined string
    // would arrive as a single word and match nothing).
    const filters = Object.entries(options).map(([key, value]) => `Name=${key},Values=${value}`);
    const args = filters.length ? ["--filters", ...filters] : [];
    const { Images } = await aws.spawn($`ec2 describe-images --owners self ${args}`);
    return Images.sort((a, b) => (a.CreationDate < b.CreationDate ? 1 : -1));
  },
};

/**
 * @typedef CloudInit
 * @property {string} [distro]
 * @property {SshKey[]} [sshKeys]
 * @property {string} [username]
 * @property {string} [password]
 * @property {Os} [os]
 */

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
export function getUserData(cloudInit) {
  const { os, userData } = cloudInit;

  // For Windows, use PowerShell script
  if (os === "windows") {
    return getWindowsStartupScript(cloudInit);
  }

  // For Linux, just set up SSH access
  return getCloudInit(cloudInit);
}

/**
 * Root disk size: an explicit --disk-size-gb wins; otherwise the bake shape
 * on the image's spec entry (linux 100GB, windows 150GB today).
 * @param {MachineOptions} options
 * @returns {number}
 */
export function getDiskSize(options) {
  const { diskSizeGb } = options;
  if (diskSizeGb) {
    return diskSizeGb;
  }
  return options.imageEntry.bake.diskSizeGb;
}

/**
 * @typedef SshKey
 * @property {string} [privatePath]
 * @property {string} [publicPath]
 * @property {string} publicKey
 */

/**
 * @typedef SshOptions
 * @property {string} hostname
 * @property {number} [port]
 * @property {string} [username]
 * @property {string} [password]
 * @property {string[]} [command]
 * @property {string[]} [identityPaths]
 * @property {number} [retries]
 */

/**
 * @typedef ScpOptions
 * @property {string} hostname
 * @property {string} source
 * @property {string} destination
 * @property {string[]} [identityPaths]
 * @property {string} [port]
 * @property {string} [username]
 * @property {number} [retries]
 */

/**
 * @param {ScpOptions} options
 * @returns {Promise<void>}
 */
async function spawnScp(options) {
  const { hostname, port, username, identityPaths, password, source, destination, retries = 3 } = options;
  await waitForPort({ hostname, port: port || 22 });

  const command = ["scp", "-o", "StrictHostKeyChecking=no"];
  command.push("-O"); // use SCP instead of SFTP
  if (statSync(resolve(source)).isDirectory()) {
    command.push("-r"); // upload the tree (bootstrap sources)
  }
  if (!password) {
    command.push("-o", "BatchMode=yes");
  }
  if (port) {
    command.push("-P", port);
  }
  if (password) {
    const sshPass = which("sshpass", { required: true });
    command.unshift(sshPass, "-p", password);
  } else if (identityPaths) {
    command.push(...identityPaths.flatMap(path => ["-i", path]));
  }
  command.push(resolve(source));
  if (username) {
    command.push(`${username}@${hostname}:${destination}`);
  } else {
    command.push(`${hostname}:${destination}`);
  }

  let cause;
  for (let i = 0; i < retries; i++) {
    const result = await spawn(command, { stdio: "inherit" });
    const { exitCode, stderr } = result;
    if (exitCode === 0) {
      return;
    }

    cause = stderr.trim() || undefined;
    if (/(bad configuration option)|(no such file or directory)/i.test(stderr)) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  throw new Error(`SCP failed: ${source} -> ${username}@${hostname}:${destination}`, { cause });
}

/**
 * @param {string} passwordData
 * @param {string} privateKeyPath
 * @returns {string}
 */
function decryptPassword(passwordData, privateKeyPath) {
  const name = basename(privateKeyPath, extname(privateKeyPath));
  const tmpPemPath = mkdtemp("pem-", `${name}.pem`);
  try {
    copyFile(privateKeyPath, tmpPemPath, { mode: 0o600 });
    spawnSyncSafe(["ssh-keygen", "-p", "-m", "PEM", "-f", tmpPemPath, "-N", ""]);
    const { stdout } = spawnSyncSafe(
      ["openssl", "pkeyutl", "-decrypt", "-inkey", tmpPemPath, "-pkeyopt", "rsa_padding_mode:pkcs1"],
      {
        stdin: Buffer.from(passwordData, "base64"),
      },
    );
    return stdout.trim();
  } finally {
    rm(tmpPemPath);
  }
}

/**
 * @typedef RdpCredentials
 * @property {string} hostname
 * @property {string} username
 * @property {string} password
 */

/**
 * @typedef Cloud
 * @property {string} name
 * @property {(options: MachineOptions) => Promise<Machine>} createMachine
 */

function getCloud(name) {
  switch (name) {
    case "docker":
      return docker;
    case "aws":
      return aws;
    case "azure":
      return azure;
    case "tart":
      return tart;
  }
  throw new Error(`Unsupported cloud: ${name}`);
}

/**
 * @typedef {"linux" | "darwin" | "windows"} Os
 * @typedef {"aarch64" | "x64"} Arch
 * @typedef {"macos" | "windowsserver" | "debian" | "ubuntu" | "alpine" | "amazonlinux"} Distro
 */

/**
 * @typedef {Object} Platform
 * @property {Os} os
 * @property {Arch} arch
 * @property {Distro} distro
 * @property {string} release
 * @property {string} [eol]
 */

/**
 * @typedef {Object} Machine
 * @property {string} cloud
 * @property {Os} [os]
 * @property {Arch} [arch]
 * @property {Distro} [distro]
 * @property {string} [release]
 * @property {string} [name]
 * @property {string} id
 * @property {string} imageId
 * @property {string} instanceType
 * @property {string} region
 * @property {string} [publicIp]
 * @property {boolean} [preemptible]
 * @property {Record<string, string>} tags
 * @property {string} [userData]
 * @property {(command: string[], options?: import("./utils.mjs").SpawnOptions) => Promise<import("./utils.mjs").SpawnResult>} spawn
 * @property {(command: string[], options?: import("./utils.mjs").SpawnOptions) => Promise<import("./utils.mjs").SpawnResult>} spawnSafe
 * @property {(source: string, destination: string) => Promise<void>} upload
 * @property {() => Promise<RdpCredentials>} [rdp]
 * @property {() => Promise<void>} attach
 * @property {() => Promise<string>} snapshot
 * @property {() => Promise<void>} close
 */

/**
 * @typedef MachineOptions
 * @property {Cloud} cloud
 * @property {Os} os
 * @property {Arch} arch
 * @property {Distro} distro
 * @property {string} [release]
 * @property {string} [name]
 * @property {string} [instanceType]
 * @property {string} [imageId]
 * @property {string} [imageName]
 * @property {number} [cpuCount]
 * @property {number} [memoryGb]
 * @property {number} [diskSizeGb]
 * @property {boolean} [preemptible]
 * @property {boolean} [detached]
 * @property {Record<string, unknown>} [tags]
 * @property {boolean} [bootstrap]
 * @property {boolean} [ci]
 * @property {boolean} [rdp]
 * @property {string} [userData]
 * @property {SshKey[]} sshKeys
 */

async function getAzureToken(tenantId, clientId, clientSecret) {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://management.azure.com/.default`,
  });
  if (!response.ok) throw new Error(`Azure auth failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

/**
 * Build a Windows image using Packer (Azure only).
 * Packer handles VM creation, bootstrap, sysprep, and gallery capture via WinRM.
 * This eliminates all the Azure Run Command issues (output truncation, x64 emulation,
 * PATH not refreshing, stderr false positives, quote escaping).
 */
/**
 * Build a Windows CI image with Packer (Azure only). Packer handles VM
 * creation, WinRM provisioning, sysprep, and gallery capture. Everything
 * that varies — base image, bake VM, disk, gallery destination, replication
 * regions, the pinned node, the bootstrap command — comes from the image's
 * spec entry via scripts/build/ci/packer.ts, which renders the template as
 * JSON in memory (no checked-in .pkr.hcl).
 *
 * @param {object} options
 * @param {string} options.imageName exact gallery image definition name (`${key}-${hash}`)
 * @param {"x64" | "aarch64"} options.arch
 * @param {boolean} options.ci
 * @param {string} options.repoRef
 * @param {string} options.agentPath esbuild-bundled agent.mjs
 * @param {string} options.bootstrapDir directory holding scripts/build/ci
 */
async function buildWindowsImageWithPacker({ image, ci, repoRef, agentPath, bootstrapDir }) {
  const { getSecret } = await import("./utils.mjs");
  if (image.os !== "windows") {
    throw new Error(`buildWindowsImageWithPacker: ${image.key} is not a windows image entry`);
  }
  const key = image.key;
  const arch = image.arch;
  const imageName = computeImageName(image);

  // Azure credentials from Buildkite secrets. The gallery name/location live
  // in the spec (image.gallery); the resource group and where Packer puts
  // its temporary build resources come from the CI secrets.
  const clientId = await getSecret("AZURE_CLIENT_ID");
  const clientSecret = await getSecret("AZURE_CLIENT_SECRET");
  const subscriptionId = await getSecret("AZURE_SUBSCRIPTION_ID");
  const tenantId = await getSecret("AZURE_TENANT_ID");
  const resourceGroup = await getSecret("AZURE_RESOURCE_GROUP");

  const galleryPath = `/subscriptions/${subscriptionId}/resourceGroups/${image.gallery.resourceGroup}/providers/Microsoft.Compute/galleries/${image.gallery.name}/images/${imageName}`;
  const token = await getAzureToken(tenantId, clientId, clientSecret);

  // Idempotent by name: if this exact `${key}-${hash}` version already exists
  // (another branch with the same spec, or a retried bake), reuse it. Same
  // hash = same recipe, so nothing to redo.
  const versionPath = `${galleryPath}/versions/${image.gallery.imageVersion}`;
  const existing = await fetch(`https://management.azure.com${versionPath}?api-version=2024-03-03`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (existing.ok) {
    const body = await existing.json();
    const state = body?.properties?.provisioningState;
    if (state === "Succeeded") {
      console.log(`[packer] ${imageName} already exists and Succeeded; reusing (nothing to bake)`);
      return;
    }
    if (state === "Creating" || state === "Updating") {
      // Another bake of this exact recipe is in flight (same hash from a
      // sibling run). Racing it would collide on the version PUT; the other
      // run will produce the identical image, so stop cleanly.
      throw new Error(`[packer] ${imageName} is already being baked (state ${state}); not racing it`);
    }
    // Failed / Canceled / anything else: a dead version that would 409 the
    // publish. Remove it so this bake can produce the version fresh.
    console.log(`[packer] ${imageName} exists in state "${state}"; deleting it before re-baking`);
    const del = await fetch(`https://management.azure.com${versionPath}?api-version=2024-03-03`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.status === 202) {
      const op = del.headers.get("Azure-AsyncOperation") ?? del.headers.get("Location");
      for (let i = 0; op && i < 120; i++) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        const poll = await fetch(op, { headers: { Authorization: `Bearer ${token}` } });
        const pollBody = await poll.json();
        if (pollBody.status === "Succeeded") break;
        if (pollBody.status === "Failed") {
          throw new Error(`Delete of ${versionPath} failed: ${JSON.stringify(pollBody)}`);
        }
      }
    } else if (!del.ok && del.status !== 404) {
      throw new Error(`Failed to delete stale gallery image version: ${del.status} ${await del.text()}`);
    }
  } else if (existing.status !== 404) {
    // Anything but "not found" is an auth/API problem — don't read it as
    // "doesn't exist" and quietly kick off a full re-bake.
    throw new Error(`[packer] Gallery version probe failed: ${existing.status} ${await existing.text()}`);
  }

  console.log(`[packer] Ensuring gallery image definition: ${imageName}`);
  const defResponse = await fetch(`https://management.azure.com${galleryPath}?api-version=2024-03-03`, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      location: image.gallery.location,
      properties: {
        osType: "Windows",
        osState: "Generalized",
        hyperVGeneration: "V2",
        architecture: arch === "aarch64" ? "Arm64" : "x64",
        // (publisher, offer, sku) must be unique per gallery; the content-
        // addressed definition name is unique by construction, so it is the sku.
        identifier: { publisher: "bun", offer: `windows-${arch}-ci`, sku: imageName },
        features: [
          { name: "DiskControllerTypes", value: "SCSI, NVMe" },
          { name: "SecurityType", value: "TrustedLaunch" },
        ],
      },
    }),
  });
  if (!defResponse.ok && defResponse.status !== 409) {
    throw new Error(`Failed to create gallery image definition: ${defResponse.status} ${await defResponse.text()}`);
  }

  // Render the Packer template from the spec entry.
  const packerBin = await ensurePacker(packer.version);
  const template = windowsPackerTemplate({
    image,
    imageName,
    repoRef,
    bootstrapDir,
    agentPath,
    azure: {
      clientId,
      clientSecret,
      subscriptionId,
      tenantId,
      // Dedicated build RG so Packer's 4-core bake VMs don't contend with
      // robobun CI runners for the runner quota. (The gallery's own RG is
      // a spec fact, image.gallery.resourceGroup, read by the template.)
      buildResourceGroup: `${resourceGroup}-PACKER`,
      location: image.gallery.location,
    },
  });
  const templateDir = mkdtempSync(join(tmpdir(), "packer-"));
  const templatePath = join(templateDir, `${key}.pkr.json`);
  writeFileSync(templatePath, JSON.stringify(template, null, 2));
  console.log(`[packer] Template: ${templatePath}`);

  console.log("[packer] Initializing plugins...");
  await spawnSafe([packerBin, "init", templatePath], { stdio: "inherit" });

  console.log(`[packer] Building ${imageName}`);
  const packerArgs = [packerBin, "build", templatePath];

  // Packer's azure-arm builder cleans up its temp pkr* resources on
  // SIGINT/SIGTERM, but only if the signal reaches the packer process and
  // it has time to finish the Azure deletes. Spawn directly and forward, or
  // a Buildkite cancel orphans the VM/NIC/IP/disk/vnet/NSG/keyvault stack.
  const child = nodeSpawn(packerArgs[0], packerArgs.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ARM_CLIENT_ID: clientId,
      ARM_CLIENT_SECRET: clientSecret,
      ARM_SUBSCRIPTION_ID: subscriptionId,
      ARM_TENANT_ID: tenantId,
    },
  });
  let cancelled = false;
  const forward = signal => {
    cancelled = true;
    console.log(`[packer] received ${signal}, forwarding to packer for Azure cleanup...`);
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const [code, signal] = await new Promise(done => child.on("close", (c, s) => done([c, s])));
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  if (cancelled) {
    console.log("[packer] cleanup after cancel finished");
    process.exit(1);
  }
  if (code !== 0) {
    throw new Error(`packer build exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
  }

  console.log(`[packer] Image built successfully: ${imageName}`);
}

/**
 * Bake a Linux CI image with Packer's amazon-ebs builder: resolve the FLOATING
 * base AMI from the spec's owner + name glob, launch a spot bake VM, run the
 * delivery shim (fetch pinned node → bootstrap.ts) over SSH, install the agent
 * service, and register the AMI under the content-addressed name. Packer
 * owns the temp keypair / security group / instance and cleans them up even
 * when the bake fails or is cancelled.
 *
 * Idempotent by name: the pre-launch describe-images check in main() has
 * already returned when the AMI exists, so reaching here means it doesn't.
 */
async function buildLinuxImageWithPacker({ image, repoRef, agentPath, bootstrapDir }) {
  const { getSecret } = await import("./utils.mjs");
  if (image.os !== "linux") {
    throw new Error(`buildLinuxImageWithPacker: ${image.key} is not a linux image entry`);
  }
  const key = image.key;
  const imageName = computeImageName(image);
  const region = (await getSecret("EC2_REGION", { required: false })) || "us-east-1";
  const accessKeyId = await getSecret("EC2_ACCESS_KEY_ID");
  const secretAccessKey = await getSecret("EC2_SECRET_ACCESS_KEY");

  const packerBin = await ensurePacker(packer.version);
  const template = linuxPackerTemplate({
    image,
    imageName,
    repoRef,
    bootstrapDir,
    agentPath,
    aws: { region },
  });
  const templateDir = mkdtempSync(join(tmpdir(), "packer-"));
  const templatePath = join(templateDir, `${key}.pkr.json`);
  writeFileSync(templatePath, JSON.stringify(template, null, 2));
  console.log(`[packer] Template: ${templatePath}`);

  console.log("[packer] Initializing plugins...");
  await spawnSafe([packerBin, "init", templatePath], { stdio: "inherit" });

  console.log(`[packer] Building ${imageName}`);
  // Spawn directly and forward signals so a Buildkite cancel reaches packer,
  // which terminates the bake instance/keypair/security group. Killing the
  // parent instead would orphan them.
  const child = nodeSpawn(packerBin, ["build", templatePath], {
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
      AWS_REGION: region,
    },
  });
  let cancelled = false;
  const forward = signal => {
    cancelled = true;
    console.log(`[packer] received ${signal}, forwarding to packer for AWS cleanup...`);
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const [code, signal] = await new Promise(done => child.on("close", (c, s) => done([c, s])));
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  if (cancelled) {
    console.log("[packer] cleanup after cancel finished");
    process.exit(1);
  }
  if (code !== 0) {
    throw new Error(`packer build exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
  }

  console.log(`[packer] Image built successfully: ${imageName}`);
}

/**
 * Download and install Packer if not already available, at the version the
 * spec pins for the gallery being built.
 * @param {string} version
 */
async function ensurePacker(version) {
  // Check if packer is already in PATH
  const packerPath = which("packer");
  if (packerPath) {
    console.log("[packer] Found:", packerPath);
    return packerPath;
  }

  // Check if we have a local copy
  const localPacker = join(tmpdir(), "packer");
  if (existsSync(localPacker)) {
    return localPacker;
  }

  // Download Packer (URL derived from the spec-pinned version)
  const hostOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const hostArch = process.arch === "arm64" ? "aarch64" : "x64";
  const { url } = packerDownload(version, hostOs, hostArch);

  console.log(`[packer] Downloading Packer ${version} from ${url}...`);
  const zipPath = join(tmpdir(), "packer.zip");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download Packer: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(zipPath, buffer);

  // Extract
  await spawnSafe(["unzip", "-o", zipPath, "-d", tmpdir()], { stdio: "inherit" });
  chmodSync(localPacker, 0o755);

  console.log(`[packer] Installed Packer ${version}`);
  return localPacker;
}

async function main() {
  const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
  const command = process.argv[2];
  if (command !== "create-image") {
    throw new Error(`Usage: ./${scriptPath} create-image --image=<key> --cloud=<aws|azure> [--ci]`);
  }

  const { values: args } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: false,
    options: {
      "image": { type: "string" },
      "cloud": { type: "string", default: "aws" },
      "ci": { type: "boolean" },
    },
  });

  // The spec image entry this run bakes: named exactly by --image (the spec
  // key). ci.mjs passes it. Nothing here reverse-engineers a key from
  // os/arch/distro (that reconstruction can't recover abi/features).
  const imageKeyFlag = args["image"];
  if (!imageKeyFlag) {
    throw new Error("--image=<key> is required (a key from scripts/build/ci/spec.ts)");
  }
  const image = imageEntry(imageKeyFlag);
  const ci = args["ci"] === true;

  // The image name is COMPUTED from the entry (`${key}-${hash}`) — never
  // taken from the command line — so what gets baked can only be named
  // what the spec says it is.
  const bakeName = ci ? computeImageName(image) : undefined;

  // The ref bootstrap shallow-clones for the prefetch caches: pinned to the
  // triggering branch so a PR that bumps a dep bakes the new tarball into
  // the image it builds. The value reaches a remote shell, so reject
  // anything outside the git-ref character set rather than try to quote it.
  const branch = getBranch();
  const repoRef = branch && /^[\w./-]+$/.test(branch) ? branch : "main";

  // Stage what every bake VM receives: bootstrap.ts + its modules + the
  // spec, laid out at their repo-relative paths (dir named to match the
  // delivery root's basename), plus the esbuild-bundled agent, named from
  // the spec fact the service path also derives from.
  const bootstrapDir = join(mkdtempSync(join(tmpdir(), "bootstrap-")), basename(LINUX_REMOTE_ROOT));
  for (const dir of BOOTSTRAP_SOURCE_DIRS) {
    cpSync(resolve(import.meta.dirname, "..", dir), join(bootstrapDir, dir), { recursive: true });
  }
  console.log("Bootstrap sources:", bootstrapDir);
  const npx = which("bunx") || which("npx");
  if (!npx) {
    throw new Error("Executable not found: bunx or npx (needed to bundle agent.mjs)");
  }
  const entryPath = resolve(import.meta.dirname, "agent.mjs");
  const agentPath = join(mkdtempSync(join(tmpdir(), "agent-")), image.paths.buildkiteAgentEntry);
  await spawnSafe($`${npx} esbuild ${entryPath} --bundle --platform=node --format=esm --outfile=${agentPath}`);

  if (image.os === "windows") {
    // Windows bakes through azure-arm; its idempotency check (the gallery
    // version probe) is inside the function.
    await buildWindowsImageWithPacker({ image, ci, repoRef, agentPath, bootstrapDir });
    return;
  }

  // Idempotent by name on AWS: one cheap describe-images by exact name
  // BEFORE launching anything. Same name means the identical recipe already
  // baked (another branch, or a retried job), so there is nothing to do.
  if (bakeName) {
    const [existing] = await aws.describeImages({ "state": "available", "name": bakeName });
    if (existing) {
      console.log(`[aws] ${bakeName} already exists (${existing.ImageId}); reusing (nothing to bake)`);
      return;
    }
    console.log(`[aws] ${bakeName} does not exist yet; baking it`);
  }

  // Linux bakes through amazon-ebs: Packer resolves the base AMI glob,
  // launches a spot bake VM, runs the delivery shim over SSH, and registers
  // the AMI, owning the temp instance/keypair/security-group lifecycle
  // including cleanup on failure.
  await buildLinuxImageWithPacker({ image, repoRef, agentPath, bootstrapDir });
}

// Run only when executed as the entry point (node scripts/machine.mjs …),
// not when the module is imported for its types (e.g. azure.mjs's JSDoc).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main();
}

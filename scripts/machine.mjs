#!/usr/bin/env node

import { inspect, parseArgs } from "node:util";
import {
  $,
  getBootstrapVersion,
  getBuildNumber,
  getSecret,
  isCI,
  parseArch,
  parseOs,
  readFile,
  spawn,
  spawnSafe,
  spawnSyncSafe,
  startGroup,
  tmpdir,
  waitForPort,
  which,
  escapePowershell,
} from "./utils.mjs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docker = {
  getPlatform(platform) {
    const { os, arch } = platform;

    if (os === "linux" || os === "windows") {
      if (arch === "aarch64") {
        return `${os}/arm64`;
      } else if (arch === "x64") {
        return `${os}/amd64`;
      }
    }

    throw new Error(`Unsupported platform: ${inspect(platform)}`);
  },

  async createMachine(platform) {
    const { id } = await docker.getImage(platform);
    const platformString = docker.getPlatform(platform);

    const command = ["sleep", "1d"];
    const { stdout } = await spawnSafe(["docker", "run", "--rm", "--platform", platformString, "-d", id, ...command]);
    const containerId = stdout.trim();

    const spawn = async command => {
      return spawn(["docker", "exec", containerId, ...command]);
    };

    const spawnSafe = async command => {
      return spawnSafe(["docker", "exec", containerId, ...command]);
    };

    const attach = async () => {
      const { exitCode, spawnError } = await spawn(["docker", "exec", "-it", containerId, "bash"], {
        stdio: "inherit",
      });

      if (exitCode === 0 || exitCode === 130) {
        return;
      }

      throw spawnError;
    };

    const kill = async () => {
      await spawnSafe(["docker", "kill", containerId]);
    };

    return {
      spawn,
      spawnSafe,
      attach,
      close: kill,
      [Symbol.asyncDispose]: kill,
    };
  },

  async getImage(platform) {
    const os = platform["os"];
    const distro = platform["distro"];
    const release = platform["release"] || "latest";

    let url;
    if (os === "linux") {
      if (distro === "debian") {
        url = `docker.io/library/debian:${release}`;
      } else if (distro === "ubuntu") {
        url = `docker.io/library/ubuntu:${release}`;
      } else if (distro === "amazonlinux") {
        url = `public.ecr.aws/amazonlinux/amazonlinux:${release}`;
      } else if (distro === "alpine") {
        url = `docker.io/library/alpine:${release}`;
      }
    }

    if (url) {
      await spawnSafe(["docker", "pull", "--platform", docker.getPlatform(platform), url]);
      const { stdout } = await spawnSafe(["docker", "image", "inspect", url, "--format", "json"]);
      const [{ Id }] = JSON.parse(stdout);
      return {
        id: Id,
        name: url,
        username: "root",
      };
    }

    throw new Error(`Unsupported platform: ${inspect(platform)}`);
  },
};

export const aws = {
  get name() {
    return "aws";
  },

  /**
   * @param {string[]} args
   * @returns {Promise<unknown>}
   */
  async spawn(args) {
    const aws = which("aws");
    if (!aws) {
      throw new Error("AWS CLI is not installed, please install it");
    }

    let env;
    if (isCI) {
      env = {
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID", { required: true }),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY", { required: true }),
        AWS_REGION: getSecret("EC2_REGION", { required: false }) || "us-east-1",
      };
    }

    const { error, stdout } = await spawn($`${aws} ${args} --output json`, { env });
    if (error) {
      if (/max attempts exceeded/i.test(inspect(error))) {
        return this.spawn(args);
      }
      throw error;
    }

    try {
      return JSON.parse(stdout);
    } catch {
      return;
    }
  },

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {string[]}
   */
  getFilters(options = {}) {
    return Object.entries(options)
      .filter(([_, value]) => typeof value !== "undefined")
      .map(([key, value]) => `Name=${key},Values=${value}`);
  },

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {string[]}
   */
  getFlags(options = {}) {
    return Object.entries(options)
      .filter(([_, value]) => typeof value !== "undefined")
      .map(([key, value]) => `--${key}=${value}`);
  },

  /**
   * @typedef AwsInstance
   * @property {string} InstanceId
   * @property {string} ImageId
   * @property {string} InstanceType
   * @property {string} [PublicIpAddress]
   * @property {string} [PlatformDetails]
   * @property {string} [Architecture]
   * @property {object} [Placement]
   * @property {string} [Placement.AvailabilityZone]
   * @property {string} LaunchTime
   */

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {Promise<AwsInstance[]>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-instances.html
   */
  async describeInstances(options) {
    const filters = aws.getFilters(options);
    const { Reservations } = await aws.spawn($`ec2 describe-instances --filters ${filters}`);
    return Reservations.flatMap(({ Instances }) => Instances).sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {Promise<AwsInstance[]>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/run-instances.html
   */
  async runInstances(options) {
    const flags = aws.getFlags(options);
    const { Instances } = await aws.spawn($`ec2 run-instances ${flags}`);
    return Instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  /**
   * @param {...string} instanceIds
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/stop-instances.html
   */
  async stopInstances(...instanceIds) {
    await aws.spawn($`ec2 stop-instances --no-hibernate --force --instance-ids ${instanceIds}`);
  },

  /**
   * @param {...string} instanceIds
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/terminate-instances.html
   */
  async terminateInstances(...instanceIds) {
    await aws.spawn($`ec2 terminate-instances --instance-ids ${instanceIds}`);
  },

  /**
   * @param {"instance-running" | "instance-stopped" | "instance-terminated"} action
   * @param {...string} instanceIds
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/wait.html
   */
  async waitInstances(action, ...instanceIds) {
    await aws.spawn($`ec2 wait ${action} --instance-ids ${instanceIds}`);
  },

  /**
   * @typedef AwsImage
   * @property {string} ImageId
   * @property {string} Name
   * @property {string} State
   * @property {string} CreationDate
   */

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {Promise<AwsImage[]>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-images.html
   */
  async describeImages(options = {}) {
    const { ["owner-alias"]: owners, ...filterOptions } = options;
    const filters = aws.getFilters(filterOptions);
    if (owners) {
      filters.push(`--owners=${owners}`);
    }
    const { Images } = await aws.spawn($`ec2 describe-images --filters ${filters}`);
    return Images.sort((a, b) => (a.CreationDate < b.CreationDate ? 1 : -1));
  },

  /**
   * @param {Record<string, string | undefined>} [options]
   * @returns {Promise<string>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/create-image.html
   */
  async createImage(options) {
    const flags = aws.getFlags(options);
    try {
      const { ImageId } = await aws.spawn($`ec2 create-image ${flags}`);
      return ImageId;
    } catch (error) {
      const match = /already in use by AMI (ami-[a-z0-9]+)/i.exec(inspect(error));
      if (!match) {
        throw error;
      }
      const [, existingImageId] = match;
      await aws.spawn($`ec2 deregister-image --image-id ${existingImageId}`);
      const { ImageId } = await aws.spawn($`ec2 create-image ${flags}`);
      return ImageId;
    }
  },

  /**
   * @param {Record<string, string | undefined>} options
   * @returns {Promise<string>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/copy-image.html
   */
  async copyImage(options) {
    const flags = aws.getFlags(options);
    const { ImageId } = await aws.spawn($`ec2 copy-image ${flags}`);
    return ImageId;
  },

  /**
   * @param {"image-available"} action
   * @param {...string} imageIds
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/wait/image-available.html
   */
  async waitImage(action, ...imageIds) {
    await aws.spawn($`ec2 wait ${action} --image-ids ${imageIds}`);
  },

  /**
   * @param {AwsImage | string} imageOrImageId
   * @returns {Promise<AwsImage>}
   */
  async getAvailableImage(imageOrImageId) {
    let imageId = imageOrImageId;
    if (typeof imageOrImageId === "object") {
      const { ImageId, State } = imageOrImageId;
      if (State === "available") {
        return imageOrImageId;
      }
      imageId = ImageId;
    }

    await aws.waitImage("image-available", imageId);
    const [availableImage] = await aws.describeImages({
      "state": "available",
      "image-id": imageId,
    });

    if (!availableImage) {
      throw new Error(`Failed to find available image: ${imageId}`);
    }

    return availableImage;
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<AwsImage>}
   */
  async getBaseImage(options) {
    const { os, arch, distro, distroVersion } = options;

    let name, owner;
    if (os === "linux") {
      if (!distro || distro === "debian") {
        owner = "amazon";
        name = `debian-${distroVersion || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-*`;
      } else if (distro === "ubuntu") {
        owner = "099720109477";
        name = `ubuntu/images/hvm-ssd*/ubuntu-*-${distroVersion || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-server-*`;
      } else if (distro === "amazonlinux") {
        owner = "amazon";
        if (distroVersion === "1" && arch === "x64") {
          name = `amzn-ami-2018.03.*`;
        } else if (distroVersion === "2") {
          name = `amzn2-ami-hvm-*-${arch === "aarch64" ? "arm64" : "x86_64"}-gp2`;
        } else {
          name = `al${distroVersion || "*"}-ami-*-${arch === "aarch64" ? "arm64" : "x86_64"}`;
        }
      } else if (distro === "alpine") {
        owner = "538276064493";
        name = `alpine-${distroVersion || "*"}.*-${arch === "aarch64" ? "aarch64" : "x86_64"}-uefi-cloudinit-*`;
      } else if (distro === "centos") {
        owner = "aws-marketplace";
        name = `CentOS-Stream-ec2-${distroVersion || "*"}-*.${arch === "aarch64" ? "aarch64" : "x86_64"}-*`;
      }
    } else if (os === "windows") {
      if (!distro || distro === "server") {
        owner = "amazon";
        name = `Windows_Server-${distroVersion || "*"}-English-Full-Base-*`;
      }
    }

    if (!name) {
      throw new Error(`Unsupported platform: ${inspect(options)}`);
    }

    const baseImages = await aws.describeImages({
      "state": "available",
      "owner-alias": owner,
      "name": name,
    });

    if (!baseImages.length) {
      throw new Error(`No base image found: ${inspect(options)}`);
    }

    const [baseImage] = baseImages;
    return aws.getAvailableImage(baseImage);
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<Machine>}
   */
  async createMachine(options) {
    const { os, arch, imageId, instanceType, tags } = options;

    /** @type {AwsImage} */
    let image;
    if (imageId) {
      image = await aws.getAvailableImage(imageId);
    } else {
      image = await aws.getBaseImage(options);
    }

    const { ImageId, Name, RootDeviceName, BlockDeviceMappings } = image;
    const blockDeviceMappings = BlockDeviceMappings.map(device => {
      const { DeviceName } = device;
      if (DeviceName === RootDeviceName) {
        return {
          ...device,
          Ebs: {
            VolumeSize: getDiskSize(options),
          },
        };
      }
      return device;
    });

    const username = getUsername(Name);

    let userData = getUserData({ ...options, username });
    if (os === "windows") {
      userData = `<powershell>${userData}</powershell><powershellArguments>-ExecutionPolicy Unrestricted -NoProfile -NonInteractive</powershellArguments><persist>false</persist>`;
    }

    let tagSpecification = [];
    if (tags) {
      tagSpecification = ["instance", "volume"].map(resourceType => {
        return {
          ResourceType: resourceType,
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value) })),
        };
      });
    }

    const [instance] = await aws.runInstances({
      ["image-id"]: ImageId,
      ["instance-type"]: instanceType || (arch === "aarch64" ? "t4g.large" : "t3.large"),
      ["user-data"]: userData,
      ["block-device-mappings"]: JSON.stringify(blockDeviceMappings),
      ["metadata-options"]: JSON.stringify({
        "HttpTokens": "optional",
        "HttpEndpoint": "enabled",
        "HttpProtocolIpv6": "enabled",
        "InstanceMetadataTags": "enabled",
      }),
      ["tag-specifications"]: JSON.stringify(tagSpecification),
    });

    return aws.toMachine(instance, { ...options, username });
  },

  /**
   * @param {AwsInstance} instance
   * @param {MachineOptions} [options]
   * @returns {Machine}
   */
  toMachine(instance, options = {}) {
    let { InstanceId, ImageId, InstanceType, Placement, PublicIpAddress } = instance;

    const connect = async () => {
      if (!PublicIpAddress) {
        await aws.waitInstances("instance-running", InstanceId);
        const [{ PublicIpAddress: IpAddress }] = await aws.describeInstances({
          ["instance-id"]: InstanceId,
        });
        PublicIpAddress = IpAddress;
      }

      const { username, sshKeys } = options;
      const identityPaths = sshKeys
        ?.filter(({ privatePath }) => existsSync(privatePath))
        ?.map(({ privatePath }) => privatePath);

      return { hostname: PublicIpAddress, username, identityPaths };
    };

    const spawn = async (command, options) => {
      const connectOptions = await connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const spawnSafe = async (command, options) => {
      const connectOptions = await connect();
      return spawnSshSafe({ ...connectOptions, command }, options);
    };

    const attach = async () => {
      const connectOptions = await connect();
      await spawnSshSafe({ ...connectOptions });
    };

    const upload = async (source, destination) => {
      const connectOptions = await connect();
      await spawnScp({ ...connectOptions, source, destination });
    };

    const snapshot = async name => {
      await aws.stopInstances(InstanceId);
      await aws.waitInstances("instance-stopped", InstanceId);
      const imageId = await aws.createImage({
        ["instance-id"]: InstanceId,
        ["name"]: name || `${InstanceId}-snapshot-${Date.now()}`,
      });
      await aws.waitImage("image-available", imageId);
      return imageId;
    };

    const terminate = async () => {
      await aws.terminateInstances(InstanceId);
    };

    return {
      cloud: "aws",
      id: InstanceId,
      imageId: ImageId,
      instanceType: InstanceType,
      region: Placement?.AvailabilityZone,
      get publicIp() {
        return PublicIpAddress;
      },
      spawn,
      spawnSafe,
      upload,
      attach,
      snapshot,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },
};

const google = {
  async createMachine(platform) {
    const image = await google.getImage(platform);
    const { id: imageId, username } = image;

    const authorizedKeys = await getAuthorizedKeys();
    const sshKeys = authorizedKeys?.map(key => `${username}:${key}`).join("\n") ?? "";

    const { os, ["instance-type"]: type } = platform;
    const instanceType = type || "e2-standard-4";

    let metadata = `ssh-keys=${sshKeys}`;
    if (os === "windows") {
      metadata += `,sysprep-specialize-script-cmd=googet -noconfirm=true install google-compute-engine-ssh,enable-windows-ssh=TRUE`;
    }

    const [{ id, networkInterfaces }] = await google.createInstances({
      ["zone"]: "us-central1-a",
      ["image"]: imageId,
      ["machine-type"]: instanceType,
      ["boot-disk-auto-delete"]: true,
      // ["boot-disk-size"]: "10GB",
      // ["boot-disk-type"]: "pd-standard",
      ["metadata"]: metadata,
    });

    const publicIp = () => {
      for (const { accessConfigs } of networkInterfaces) {
        for (const { natIP } of accessConfigs) {
          return natIP;
        }
      }
      throw new Error(`Failed to find public IP for instance: ${id}`);
    };

    const spawn = command => {
      const hostname = publicIp();
      return spawnSsh({ hostname, username, command });
    };

    const spawnSafe = command => {
      const hostname = publicIp();
      return spawnSshSafe({ hostname, username, command });
    };

    const attach = async () => {
      const hostname = publicIp();
      await spawnSshSafe({ hostname, username });
    };

    const terminate = async () => {
      await google.deleteInstance(id);
    };

    return {
      spawn,
      spawnSafe,
      attach,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },

  async getImage(platform) {
    const { os, arch, distro, release } = platform;
    const architecture = arch === "aarch64" ? "ARM64" : "X86_64";

    let name;
    let username;
    if (os === "linux") {
      if (distro === "debian") {
        name = `debian-${release}-*`;
        username = "admin";
      } else if (distro === "ubuntu") {
        name = `ubuntu-${release.replace(/\./g, "")}-*`;
        username = "ubuntu";
      }
    } else if (os === "windows" && arch === "x64") {
      if (distro === "server") {
        name = `windows-server-${release}-dc-core-*`;
        username = "administrator";
      }
    }

    if (name && username) {
      const images = await google.listImages({ name, architecture });
      if (images.length) {
        const [image] = images;
        const { name, selfLink } = image;
        return {
          id: selfLink,
          name,
          username,
        };
      }
    }

    throw new Error(`Unsupported platform: ${inspect(platform)}`);
  },

  async listImages(options = {}) {
    const filter = Object.entries(options)
      .map(([key, value]) => [value.includes("*") ? `${key}~${value}` : `${key}=${value}`])
      .join(" AND ");
    const filters = filter ? ["--filter", filter] : [];
    const { stdout } = await spawnSafe(["gcloud", "compute", "images", "list", ...filters, "--format", "json"]);
    const images = JSON.parse(stdout);
    return images.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  async listInstances(options = {}) {
    const filter = Object.entries(options)
      .map(([key, value]) => [value.includes("*") ? `${key}~${value}` : `${key}=${value}`])
      .join(" AND ");
    const filters = filter ? ["--filter", filter] : [];
    const { stdout } = await spawnSafe(["gcloud", "compute", "instances", "list", ...filters, "--format", "json"]);
    const instances = JSON.parse(stdout);
    return instances.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  async createInstances(options = {}) {
    const flags = Object.entries(options).flatMap(([key, value]) =>
      typeof value === "boolean" ? `--${key}` : `--${key}=${value}`,
    );
    const randomId = "i-" + Math.random().toString(36).substring(2, 15);
    const { stdout } = await spawnSafe([
      "gcloud",
      "compute",
      "instances",
      "create",
      randomId,
      ...flags,
      "--format",
      "json",
    ]);
    const instances = JSON.parse(stdout);
    return instances.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  async deleteInstance(instanceId) {
    await spawnSafe(["gcloud", "compute", "instances", "delete", instanceId, "--zone", "us-central1-a", "--quiet"]);
  },
};

/**
 * @typedef CloudInit
 * @property {string} [distro]
 * @property {SshKey[]} [sshKeys]
 * @property {string} [username]
 * @property {string} [password]
 */

function getUserData(cloudInit) {
  const { os } = cloudInit;
  if (os === "windows") {
    return getWindowsStartupScript(cloudInit);
  }
  return getCloudInit(cloudInit);
}

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
function getCloudInit(cloudInit) {
  const username = cloudInit["username"] || "root";
  const password = cloudInit["password"] || crypto.randomUUID();
  const authorizedKeys = JSON.stringify(cloudInit["sshKeys"]?.map(({ publicKey }) => publicKey) || []);

  let sftpPath = "/usr/lib/openssh/sftp-server";
  switch (cloudInit["distro"]) {
    case "alpine":
      sftpPath = "/usr/lib/ssh/sftp-server";
      break;
    case "amazonlinux":
    case "rhel":
    case "centos":
      sftpPath = "/usr/libexec/openssh/sftp-server";
      break;
  }

  `
    package_update: true
    packages:
      - curl
      - ca-certificates
      - openssh-server
  `;

  let users;
  if (username === "root") {
    users = [`root:${password}`];
  } else {
    users = [`root:${password}`, `${username}:${password}`];
  }

  // https://cloudinit.readthedocs.io/en/stable/
  return `#cloud-config
    write_files:
      - path: /etc/ssh/sshd_config
        content: |
          PermitRootLogin yes
          PasswordAuthentication no
          PubkeyAuthentication yes
          Subsystem sftp ${sftpPath}
    chpasswd:
      expire: false
      list: |
        ${users.join("\n")}
    disable_root: false
    ssh_pwauth: true
    ssh_authorized_keys: ${authorizedKeys}
  `;
}

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
function getWindowsStartupScript(cloudInit) {
  const { sshKeys } = cloudInit;
  const authorizedKeys = sshKeys.filter(({ publicKey }) => publicKey).map(({ publicKey }) => publicKey);

  return `
    $ErrorActionPreference = "Stop"
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

    function Install-Ssh {
      $sshService = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'
      if ($sshService.State -ne "Installed") {
        Write-Output "Installing OpenSSH server..."
        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
      }

      $pwshPath = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
      if (-not $pwshPath) {
        $pwshPath = Get-Command powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
      }

      if (-not (Get-Service -Name sshd -ErrorAction SilentlyContinue)) {
        Write-Output "Enabling OpenSSH server..."
        Set-Service -Name sshd -StartupType Automatic
        Start-Service sshd
      }

      if ($pwshPath) {
        Write-Output "Setting default shell to $pwshPath..."
        New-ItemProperty -Path "HKLM:\\SOFTWARE\\OpenSSH" -Name DefaultShell -Value $pwshPath -PropertyType String -Force
      }

      $firewallRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
      if (-not $firewallRule) {
        Write-Output "Configuring firewall..."
        New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
      }

      $sshPath = "C:\\ProgramData\\ssh"
      if (-not (Test-Path $sshPath)) {
        Write-Output "Creating SSH directory..."
        New-Item -Path $sshPath -ItemType Directory
      }

      $authorizedKeysPath = Join-Path $sshPath "administrators_authorized_keys"
      $authorizedKeys = @(${authorizedKeys.map(key => `"${escapePowershell(key)}"`).join("\n")})
      if (-not (Test-Path $authorizedKeysPath) -or (Get-Content $authorizedKeysPath) -ne $authorizedKeys) {
        Write-Output "Adding SSH keys..."
        Set-Content -Path $authorizedKeysPath -Value $authorizedKeys
      }

      $sshdConfigPath = Join-Path $sshPath "sshd_config"
      $sshdConfig = @"
        PasswordAuthentication no
        PubkeyAuthentication yes
        AuthorizedKeysFile $authorizedKeysPath
        Subsystem sftp sftp-server.exe
"@
      if (-not (Test-Path $sshdConfigPath) -or (Get-Content $sshdConfigPath) -ne $sshdConfig) {
        Write-Output "Writing SSH configuration..."
        Set-Content -Path $sshdConfigPath -Value $sshdConfig
      }

      Write-Output "Restarting SSH server..."
      Restart-Service sshd
    }

    Install-Ssh
  `;
}

/**
 * @param {string} distro
 * @returns {string}
 */
function getUsername(distro) {
  if (/windows/i.test(distro)) {
    return "administrator";
  }

  if (/alpine|centos/i.test(distro)) {
    return "root";
  }

  if (/debian/i.test(distro)) {
    return "admin";
  }

  if (/ubuntu/i.test(distro)) {
    return "ubuntu";
  }

  if (/amazon|amzn|al\d+|rhel/i.test(distro)) {
    return "ec2-user";
  }

  throw new Error(`Unsupported distro: ${distro}`);
}

/**
 * @param {MachineOptions} options
 * @returns {number}
 */
function getDiskSize(options) {
  const { os, diskSizeGb } = options;

  if (diskSizeGb) {
    return diskSizeGb;
  }

  return os === "windows" ? 50 : 30;
}

/**
 * @typedef SshKey
 * @property {string} privatePath
 * @property {string} publicPath
 * @property {string} publicKey
 */

/**
 * @returns {SshKey}
 */
function createSshKey() {
  const sshPath = join(homedir(), ".ssh");
  if (!existsSync(sshPath)) {
    mkdirSync(sshPath, { recursive: true });
  }

  const name = `id_rsa_${crypto.randomUUID()}`;
  const privatePath = join(sshPath, name);
  const publicPath = join(sshPath, `${name}.pub`);
  spawnSyncSafe(["ssh-keygen", "-t", "rsa", "-b", "4096", "-f", privatePath, "-N", ""], { stdio: "inherit" });

  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    throw new Error(`Failed to generate SSH key: ${privatePath} / ${publicPath}`);
  }

  const sshAgent = which("ssh-agent");
  const sshAdd = which("ssh-add");
  if (sshAgent && sshAdd) {
    spawnSyncSafe(["sh", "-c", `eval $(${sshAgent} -s) && ${sshAdd} ${privatePath}`], { stdio: "inherit" });
  }

  return {
    privatePath,
    publicPath,
    get publicKey() {
      return readFile(publicPath, { cache: true });
    },
  };
}

/**
 * @returns {SshKey[]}
 */
function getSshKeys() {
  const homePath = homedir();
  const sshPath = join(homePath, ".ssh");

  /** @type {SshKey[]} */
  const sshKeys = [];
  if (existsSync(sshPath)) {
    const sshFiles = readdirSync(sshPath, { withFileTypes: true });
    const publicPaths = sshFiles
      .filter(entry => entry.isFile() && entry.name.endsWith(".pub"))
      .map(({ name }) => join(sshPath, name));

    sshKeys.push(
      ...publicPaths.map(publicPath => ({
        publicPath,
        privatePath: publicPath.replace(/\.pub$/, ""),
        get publicKey() {
          return readFile(publicPath, { cache: true }).trim();
        },
      })),
    );
  }

  if (!sshKeys.length) {
    sshKeys.push(createSshKey());
  }

  return sshKeys;
}

/**
 * @typedef SshOptions
 * @property {string} hostname
 * @property {number} [port]
 * @property {string} [username]
 * @property {string[]} [command]
 * @property {string[]} [identityPaths]
 * @property {number} [retries]
 */

/**
 * @param {SshOptions} options
 * @param {object} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
async function spawnSsh(options, spawnOptions = {}) {
  const { hostname, port, username, identityPaths, command } = options;
  await waitForPort({ hostname, port: port || 22 });

  const ssh = ["ssh", hostname, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    ssh.push("-p", port);
  }
  if (username) {
    ssh.push("-l", username);
  }
  if (identityPaths) {
    ssh.push(...identityPaths.flatMap(path => ["-i", path]));
  }
  const stdio = command ? "pipe" : "inherit";
  if (command) {
    ssh.push(...command);
  }

  return spawn(ssh, { stdio, ...spawnOptions });
}

/**
 * @param {SshOptions} options
 * @param {object} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
async function spawnSshSafe(options, spawnOptions = {}) {
  const { hostname, port, username, identityPaths, command } = options;
  await waitForPort({ hostname, port: port || 22 });

  const ssh = ["ssh", hostname, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    ssh.push("-p", port);
  }
  if (username) {
    ssh.push("-l", username);
  }
  if (identityPaths) {
    ssh.push(...identityPaths.flatMap(path => ["-i", path]));
  }
  const stdio = command ? "pipe" : "inherit";
  if (command) {
    ssh.push(...command);
  }

  return spawnSafe(ssh, { stdio, ...spawnOptions });
}

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
  const { hostname, port, username, identityPaths, source, destination, retries = 10 } = options;
  await waitForPort({ hostname, port: port || 22 });

  const command = ["scp", "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    command.push("-P", port);
  }
  if (identityPaths) {
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
 * @typedef Cloud
 * @property {string} name
 * @property {(options: MachineOptions) => Promise<Machine>} createMachine
 */

/**
 * @param {string} name
 * @returns {Cloud}
 */
function getCloud(name) {
  switch (name) {
    case "aws":
      return aws;
  }
  throw new Error(`Unsupported cloud: ${name}`);
}

/**
 * @typedef Machine
 * @property {string} cloud
 * @property {string} [name]
 * @property {string} id
 * @property {string} imageId
 * @property {string} instanceType
 * @property {string} region
 * @property {string} [publicIp]
 * @property {(command: string[]) => Promise<SpawnResult>} spawn
 * @property {(command: string[]) => Promise<SpawnResult>} spawnSafe
 * @property {(source: string, destination: string) => Promise<void>} upload
 * @property {() => Promise<void>} attach
 * @property {() => Promise<string>} snapshot
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {"linux" | "darwin" | "windows"} Os
 * @typedef {"aarch64" | "x64"} Arch
 */

/**
 * @typedef MachineOptions
 * @property {Cloud} cloud
 * @property {Os} os
 * @property {Arch} arch
 * @property {string} distro
 * @property {string} [distroVersion]
 * @property {string} [imageId]
 * @property {string} [imageName]
 * @property {number} [cpuCount]
 * @property {number} [memoryGb]
 * @property {number} [diskSizeGb]
 * @property {boolean} [persistent]
 * @property {boolean} [detached]
 * @property {Record<string, unknown>} [tags]
 * @property {boolean} [bootstrap]
 * @property {boolean} [ci]
 * @property {SshKey[]} [sshKeys]
 */

async function main() {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
  });

  const [command] = positionals;
  if (!/^(ssh|create-image|publish-image)$/.test(command)) {
    const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
    throw new Error(`Usage: ./${scriptPath} [ssh|create-image|publish-image] [options]`);
  }

  const { values: args } = parseArgs({
    allowPositionals: true,
    options: {
      "cloud": { type: "string", default: "aws" },
      "os": { type: "string", default: "linux" },
      "arch": { type: "string", default: "x64" },
      "distro": { type: "string" },
      "distro-version": { type: "string" },
      "instance-type": { type: "string" },
      "image-id": { type: "string" },
      "image-name": { type: "string" },
      "cpu-count": { type: "string" },
      "memory-gb": { type: "string" },
      "disk-size-gb": { type: "string" },
      "persistent": { type: "boolean" },
      "detached": { type: "boolean" },
      "tag": { type: "string", multiple: true },
      "ci": { type: "boolean" },
      "no-bootstrap": { type: "boolean" },
      "buildkite-token": { type: "string" },
      "tailscale-authkey": { type: "string" },
    },
  });

  /** @type {MachineOptions} */
  const options = {
    cloud: getCloud(args["cloud"]),
    os: parseOs(args["os"]),
    arch: parseArch(args["arch"]),
    distro: args["distro"],
    distroVersion: args["distro-version"],
    instanceType: args["instance-type"],
    imageId: args["image-id"],
    imageName: args["image-name"],
    tags: {
      "robobun": "true",
      "robobun2": "true",
      "buildkite:token": args["buildkite-token"],
      "tailscale:authkey": args["tailscale-authkey"],
      ...Object.fromEntries(args["tag"]?.map(tag => tag.split("=")) ?? []),
    },
    cpuCount: parseInt(args["cpu-count"]) || undefined,
    memoryGb: parseInt(args["memory-gb"]) || undefined,
    diskSizeGb: parseInt(args["disk-size-gb"]) || undefined,
    persistent: !!args["persistent"],
    detached: !!args["detached"],
    bootstrap: args["no-bootstrap"] !== true,
    ci: !!args["ci"],
    sshKeys: getSshKeys(),
  };

  const { cloud, detached, bootstrap, ci, os, arch, distro, distroVersion } = options;
  const name = `${os}-${arch}-${distro}-${distroVersion}`;

  let bootstrapPath, agentPath;
  if (bootstrap) {
    bootstrapPath = resolve(import.meta.dirname, os === "windows" ? "bootstrap.ps1" : "bootstrap.sh");
    if (!existsSync(bootstrapPath)) {
      throw new Error(`Script not found: ${bootstrapPath}`);
    }
    if (ci) {
      const npx = which("bunx") || which("npx");
      if (!npx) {
        throw new Error("Executable not found: bunx or npx");
      }
      const entryPath = resolve(import.meta.dirname, "agent.mjs");
      const tmpPath = mkdtempSync(join(tmpdir(), "agent-"));
      agentPath = join(tmpPath, "agent.mjs");
      await spawnSafe($`${npx} esbuild ${entryPath} --bundle --platform=node --format=esm --outfile=${agentPath}`);
    }
  }

  /** @type {Machine} */
  const machine = await startGroup("Creating machine...", async () => {
    console.log("Creating machine:", JSON.parse(JSON.stringify(options)));
    const result = await cloud.createMachine(options);
    console.log("Created machine:", result);
    return result;
  });

  if (!detached) {
    let closing;
    for (const event of ["beforeExit", "SIGINT", "SIGTERM"]) {
      process.on(event, () => {
        if (!closing) {
          closing = true;
          machine.close().finally(() => {
            if (event !== "beforeExit") {
              process.exit(1);
            }
          });
        }
      });
    }
  }

  try {
    await startGroup("Connecting...", async () => {
      const command = os === "windows" ? ["cmd", "/c", "ver"] : ["uname", "-a"];
      await machine.spawnSafe(command, { stdio: "inherit" });
    });

    if (bootstrapPath) {
      if (os === "windows") {
        const remotePath = "C:\\Windows\\Temp\\bootstrap.ps1";
        const args = ci ? ["-CI"] : [];
        await startGroup("Running bootstrap...", async () => {
          await machine.upload(bootstrapPath, remotePath);
          await machine.spawnSafe(["powershell", remotePath, ...args], { stdio: "inherit" });
        });
      } else {
        const remotePath = "/tmp/bootstrap.sh";
        const args = ci ? ["--ci"] : [];
        await startGroup("Running bootstrap...", async () => {
          await machine.upload(bootstrapPath, remotePath);
          await machine.spawnSafe(["sh", remotePath, ...args], { stdio: "inherit" });
        });
      }
    }

    if (agentPath) {
      if (os === "windows") {
        // TODO
        // const remotePath = "C:\\Windows\\Temp\\agent.mjs";
        // await startGroup("Installing agent...", async () => {
        //   await machine.upload(agentPath, remotePath);
        //   await machine.spawnSafe(["node", remotePath, "install"], { stdio: "inherit" });
        // });
      } else {
        const tmpPath = "/tmp/agent.mjs";
        const remotePath = "/var/lib/buildkite-agent/agent.mjs";
        await startGroup("Installing agent...", async () => {
          await machine.upload(agentPath, tmpPath);
          const command = [];
          {
            const { exitCode } = await machine.spawn(["sudo", "echo", "1"], { stdio: "ignore" });
            if (exitCode === 0) {
              command.unshift("sudo");
            }
          }
          await machine.spawnSafe([...command, "cp", tmpPath, remotePath]);
          {
            const { stdout } = await machine.spawn(["node", "-v"]);
            const version = parseInt(stdout.trim().replace(/^v/, ""));
            if (isNaN(version) || version < 20) {
              command.push("bun");
            } else {
              command.push("node");
            }
          }
          await machine.spawnSafe([...command, remotePath, "install"], { stdio: "inherit" });
        });
      }
    }

    if (command === "create-image" || command === "publish-image") {
      let suffix;
      if (command === "publish-image") {
        suffix = `v${getBootstrapVersion()}`;
      } else if (isCI) {
        suffix = `build-${getBuildNumber()}`;
      } else {
        suffix = `draft-${Date.now()}`;
      }
      const label = `${name}-${suffix}`;
      await startGroup("Creating image...", async () => {
        console.log("Creating image:", label);
        const result = await machine.snapshot(label);
        console.log("Created image:", result);
      });
    }

    if (command === "ssh") {
      await machine.attach();
    }
  } catch (error) {
    if (isCI) {
      throw error;
    }
    console.error(error);
    try {
      await machine.attach();
    } catch (error) {
      console.error(error);
    }
  } finally {
    if (!detached) {
      await machine.close();
    }
  }
}

await main();

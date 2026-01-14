#!/usr/bin/env node

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, parseArgs } from "node:util";
import { docker } from "./docker.mjs";
import { tart } from "./tart.mjs";
import {
  $,
  copyFile,
  curlSafe,
  escapePowershell,
  getBootstrapVersion,
  getBuildNumber,
  getGithubApiUrl,
  getGithubUrl,
  getSecret,
  getUsernameForDistro,
  homedir,
  isCI,
  isMacOS,
  isWindows,
  mkdir,
  mkdtemp,
  parseArch,
  parseOs,
  readFile,
  rm,
  setupUserData,
  sha256,
  spawn,
  spawnSafe,
  spawnSsh,
  spawnSshSafe,
  spawnSyncSafe,
  startGroup,
  tmpdir,
  waitForPort,
  which,
  writeFile,
} from "./utils.mjs";

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
    const aws = which("aws", { required: true });

    let env;
    if (isCI) {
      env = {
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID", { required: true }),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY", { required: true }),
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
    for (let i = 0; i < 3; i++) {
      const flags = aws.getFlags(options);
      const result = await aws.spawn($`ec2 run-instances ${flags}`, {
        throwOnError: error => {
          if (options["instance-market-options"] && /InsufficientInstanceCapacity/i.test(inspect(error))) {
            delete options["instance-market-options"];
            const instanceType = options["instance-type"] || "default";
            console.warn(`There is not enough capacity for ${instanceType} spot instances, retrying with on-demand...`);
            return false;
          }
          return true;
        },
      });
      if (result) {
        const { Instances } = result;
        if (Instances.length) {
          return Instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
        }
      }
      await new Promise(resolve => setTimeout(resolve, i * Math.random() * 15_000));
    }
    throw new Error(`Failed to run instances: ${inspect(instanceOptions)}`);
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
    await aws.spawn($`ec2 terminate-instances --instance-ids ${instanceIds}`, {
      throwOnError: error => !/InvalidInstanceID\.NotFound/i.test(inspect(error)),
    });
  },

  /**
   * @param {"instance-running" | "instance-stopped" | "instance-terminated"} action
   * @param {...string} instanceIds
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/wait.html
   */
  async waitInstances(action, ...instanceIds) {
    await aws.spawn($`ec2 wait ${action} --instance-ids ${instanceIds}`, {
      retryOnError: error => /max attempts exceeded/i.test(inspect(error)),
    });
  },

  /**
   * @param {string} instanceId
   * @param {string} privateKeyPath
   * @param {object} [passwordOptions]
   * @param {boolean} [passwordOptions.wait]
   * @returns {Promise<string | undefined>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/get-password-data.html
   */
  async getPasswordData(instanceId, privateKeyPath, passwordOptions = {}) {
    const attempts = passwordOptions.wait ? 15 : 1;
    for (let i = 0; i < attempts; i++) {
      const { PasswordData } = await aws.spawn($`ec2 get-password-data --instance-id ${instanceId}`);
      if (PasswordData) {
        return decryptPassword(PasswordData, privateKeyPath);
      }
      await new Promise(resolve => setTimeout(resolve, 60000 * i));
    }
    throw new Error(`Failed to get password data for instance: ${instanceId}`);
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

    /** @type {string | undefined} */
    let existingImageId;

    /** @type {AwsImage | undefined} */
    const image = await aws.spawn($`ec2 create-image ${flags}`, {
      throwOnError: error => {
        const match = /already in use by AMI (ami-[a-z0-9]+)/i.exec(inspect(error));
        if (!match) {
          return true;
        }
        const [, imageId] = match;
        existingImageId = imageId;
        return false;
      },
    });

    if (!existingImageId) {
      const { ImageId } = image;
      return ImageId;
    }

    await aws.spawn($`ec2 deregister-image --image-id ${existingImageId}`);
    const { ImageId } = await aws.spawn($`ec2 create-image ${flags}`);
    return ImageId;
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
    await aws.spawn($`ec2 wait ${action} --image-ids ${imageIds}`, {
      retryOnError: error => /max attempts exceeded/i.test(inspect(error)),
    });
  },

  /**
   * @typedef {Object} AwsKeyPair
   * @property {string} KeyPairId
   * @property {string} KeyName
   * @property {string} KeyFingerprint
   * @property {string} [PublicKeyMaterial]
   */

  /**
   * @param {string[]} [names]
   * @returns {Promise<AwsKeyPair[]>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-key-pairs.html
   */
  async describeKeyPairs(names) {
    const command = names
      ? $`ec2 describe-key-pairs --include-public-key --key-names ${names}`
      : $`ec2 describe-key-pairs --include-public-key`;
    const { KeyPairs } = await aws.spawn(command);
    return KeyPairs;
  },

  /**
   * @param {string | Buffer} publicKey
   * @param {string} [name]
   * @returns {Promise<AwsKeyPair>}
   * @link https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/import-key-pair.html
   */
  async importKeyPair(publicKey, name) {
    const keyName = name || `key-pair-${sha256(publicKey)}`;
    const publicKeyBase64 = Buffer.from(publicKey).toString("base64");

    /** @type {AwsKeyPair | undefined} */
    const keyPair = await aws.spawn(
      $`ec2 import-key-pair --key-name ${keyName} --public-key-material ${publicKeyBase64}`,
      {
        throwOnError: error => !/InvalidKeyPair\.Duplicate/i.test(inspect(error)),
      },
    );

    if (keyPair) {
      return keyPair;
    }

    const keyPairs = await aws.describeKeyPairs(keyName);
    if (keyPairs.length) {
      return keyPairs[0];
    }

    throw new Error(`Failed to import key pair: ${keyName}`);
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
    const { os, arch, distro, release } = options;

    let name, owner;
    if (os === "linux") {
      if (!distro || distro === "debian") {
        owner = "amazon";
        name = `debian-${release || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-*`;
      } else if (distro === "ubuntu") {
        owner = "099720109477";
        name = `ubuntu/images/hvm-ssd*/ubuntu-*-${release || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-server-*`;
      } else if (distro === "amazonlinux") {
        owner = "amazon";
        if (release === "1" && arch === "x64") {
          name = `amzn-ami-2018.03.*`;
        } else if (release === "2") {
          name = `amzn2-ami-hvm-*-${arch === "aarch64" ? "arm64" : "x86_64"}-gp2`;
        } else {
          name = `al${release || "*"}-ami-*-${arch === "aarch64" ? "arm64" : "x86_64"}`;
        }
      } else if (distro === "alpine") {
        owner = "538276064493";
        name = `alpine-${release || "*"}.*-${arch === "aarch64" ? "aarch64" : "x86_64"}-uefi-cloudinit-*`;
      } else if (distro === "centos") {
        owner = "aws-marketplace";
        name = `CentOS-Stream-ec2-${release || "*"}-*.${arch === "aarch64" ? "aarch64" : "x86_64"}-*`;
      }
    } else if (os === "windows") {
      if (!distro || distro === "server") {
        owner = "amazon";
        name = `Windows_Server-${release || "*"}-English-Full-Base-*`;
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
    // console.table(baseImages.map(v => v.Name));

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
    const { os, arch, imageId, instanceType, tags, sshKeys, preemptible } = options;

    /** @type {AwsImage} */
    let image;
    if (imageId) {
      image = await aws.getAvailableImage(imageId);
    } else {
      image = await aws.getBaseImage(options);
    }

    const { ImageId, Name, RootDeviceName, BlockDeviceMappings } = image;
    // console.table({ os, arch, instanceType, Name, ImageId });

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

    const username = getUsernameForDistro(Name);

    // Only include minimal cloud-init for SSH access
    let userData = getUserData({ ...options, username });
    if (os === "windows") {
      userData = `<powershell>${userData}</powershell><powershellArguments>-ExecutionPolicy Unrestricted -NoProfile -NonInteractive</powershellArguments><persist>true</persist>`;
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

    /** @type {string | undefined} */
    let keyName, keyPath;
    if (os === "windows") {
      const sshKey = sshKeys.find(({ privatePath }) => existsSync(privatePath));
      if (sshKey) {
        const { publicKey, privatePath } = sshKey;
        const { KeyName } = await aws.importKeyPair(publicKey);
        keyName = KeyName;
        keyPath = privatePath;
      }
    }

    let marketOptions;
    if (preemptible) {
      marketOptions = JSON.stringify({
        MarketType: "spot",
        SpotOptions: {
          InstanceInterruptionBehavior: "terminate",
          SpotInstanceType: "one-time",
        },
      });
    }

    // Attach IAM instance profile for CI builds to enable S3 build cache access
    let iamInstanceProfile;
    if (options.ci) {
      iamInstanceProfile = JSON.stringify({ Name: "buildkite-build-agent" });
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
      ["key-name"]: keyName,
      ["instance-market-options"]: marketOptions,
      ["iam-instance-profile"]: iamInstanceProfile,
    });

    const machine = aws.toMachine(instance, { ...options, username, keyPath });

    await setupUserData(machine, options);

    return machine;
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

    const waitForSsh = async () => {
      const connectOptions = await connect();
      const { hostname, username, identityPaths } = connectOptions;

      // Try to connect until it succeeds
      for (let i = 0; i < 30; i++) {
        try {
          await spawnSshSafe({
            hostname,
            username,
            identityPaths,
            command: ["true"],
          });
          return;
        } catch (error) {
          if (i === 29) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    };

    const spawn = async (command, options) => {
      const connectOptions = await connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const spawnSafe = async (command, options) => {
      const connectOptions = await connect();
      return spawnSshSafe({ ...connectOptions, command }, options);
    };

    const rdp = async () => {
      const { keyPath } = options;
      const { hostname, username } = await connect();
      const password = await aws.getPasswordData(InstanceId, keyPath, { wait: true });
      return { hostname, username, password };
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
      rdp,
      snapshot,
      waitForSsh,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
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
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
function getCloudInit(cloudInit) {
  const username = cloudInit["username"] || "root";
  const password = cloudInit["password"] || crypto.randomUUID();
  const authorizedKeys = cloudInit["sshKeys"]?.map(({ publicKey }) => publicKey) || [];

  let sftpPath = "/usr/lib/openssh/sftp-server";
  let shell = "/bin/bash";
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
  switch (cloudInit["os"]) {
    case "linux":
    case "windows":
      // handled above
      break;
    default:
      throw new Error(`Unsupported os: ${cloudInit["os"]}`);
  }

  let users;
  if (username === "root") {
    users = [`root:${password}`];
  } else {
    users = [`root:${password}`, `${username}:${password}`];
  }

  // https://cloudinit.readthedocs.io/en/stable/
  return `#cloud-config
users:
  - name: ${username}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: ${shell}
    ssh_authorized_keys:
${authorizedKeys.map(key => `      - ${key}`).join("\n")}

write_files:
  - path: /etc/ssh/sshd_config
    permissions: '0644'
    owner: root:root
    content: |
      Port 22
      Protocol 2
      HostKey /etc/ssh/ssh_host_rsa_key
      HostKey /etc/ssh/ssh_host_ecdsa_key
      HostKey /etc/ssh/ssh_host_ed25519_key
      SyslogFacility AUTHPRIV
      PermitRootLogin yes
      AuthorizedKeysFile %h/.ssh/authorized_keys
      PasswordAuthentication no
      ChallengeResponseAuthentication no
      GSSAPIAuthentication yes
      GSSAPICleanupCredentials no
      UsePAM yes
      X11Forwarding yes
      PrintMotd no
      AcceptEnv LANG LC_*
      Subsystem sftp ${sftpPath}
`;
}

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
function getWindowsStartupScript(cloudInit) {
  const { sshKeys } = cloudInit;
  const authorizedKeys = sshKeys.map(({ publicKey }) => publicKey);

  return `
    $ErrorActionPreference = "Stop"
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

    function Install-Ssh {
      $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue
      if (-not $sshdService) {
        $buildNumber = Get-WmiObject Win32_OperatingSystem | Select-Object -ExpandProperty BuildNumber
        if ($buildNumber -lt 17763) {
          Write-Output "Installing OpenSSH server through Github..."
          [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
          Invoke-WebRequest -Uri "https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.8.0.0p1-Preview/OpenSSH-Win64.zip" -OutFile "$env:TEMP\\OpenSSH.zip"
          Expand-Archive -Path "$env:TEMP\\OpenSSH.zip" -DestinationPath "$env:TEMP\\OpenSSH" -Force
          Get-ChildItem -Path "$env:TEMP\\OpenSSH\\OpenSSH-Win64" -Recurse | Move-Item -Destination "$env:ProgramFiles\\OpenSSH" -Force
          & "$env:ProgramFiles\\OpenSSH\\install-sshd.ps1"
        } else {
          Write-Output "Installing OpenSSH server through Windows Update..."
          Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
        }
      }

      Write-Output "Enabling OpenSSH server..."
      Set-Service -Name sshd -StartupType Automatic
      Start-Service sshd

      $pwshPath = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
      if (-not $pwshPath) {
        $pwshPath = Get-Command powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
      }

      if ($pwshPath) {
        Write-Output "Setting default shell to $pwshPath..."
        New-ItemProperty -Path "HKLM:\\SOFTWARE\\OpenSSH" -Name DefaultShell -Value $pwshPath -PropertyType String -Force
      }

      $firewallRule = Get-NetFirewallRule -Name "OpenSSH-Server" -ErrorAction SilentlyContinue
      if (-not $firewallRule) {
        Write-Output "Configuring firewall..."
        New-NetFirewallRule -Profile Any -Name 'OpenSSH-Server' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
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
 * @param {MachineOptions} options
 * @returns {number}
 */
export function getDiskSize(options) {
  const { os, diskSizeGb } = options;

  if (diskSizeGb) {
    return diskSizeGb;
  }

  // After Visual Studio and dependencies are installed,
  // there is ~50GB of used disk space.
  if (os === "windows") {
    return 60;
  }

  return 40;
}

/**
 * @typedef SshKey
 * @property {string} [privatePath]
 * @property {string} [publicPath]
 * @property {string} publicKey
 */

/**
 * @returns {SshKey}
 */
function createSshKey() {
  const sshKeyGen = which("ssh-keygen", { required: true });
  const sshAdd = which("ssh-add", { required: true });

  const sshPath = join(homedir(), ".ssh");
  mkdir(sshPath);

  const filename = `id_rsa_${crypto.randomUUID()}`;
  const privatePath = join(sshPath, filename);
  const publicPath = join(sshPath, `${filename}.pub`);
  spawnSyncSafe([sshKeyGen, "-t", "rsa", "-b", "4096", "-f", privatePath, "-N", ""], { stdio: "inherit" });
  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    throw new Error(`Failed to generate SSH key: ${privatePath} / ${publicPath}`);
  }

  if (isWindows) {
    spawnSyncSafe([sshAdd, privatePath], { stdio: "inherit" });
  } else {
    const sshAgent = which("ssh-agent");
    if (sshAgent) {
      spawnSyncSafe(["sh", "-c", `eval $(${sshAgent} -s) && ${sshAdd} ${privatePath}`], { stdio: "inherit" });
    }
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
    const sshFiles = readdirSync(sshPath, { withFileTypes: true, encoding: "utf-8" });
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
 * @param {string} username
 * @returns {Promise<SshKey[]>}
 */
async function getGithubUserSshKeys(username) {
  const url = new URL(`${username}.keys`, getGithubUrl());
  const publicKeys = await curlSafe(url);
  return publicKeys
    .split("\n")
    .filter(key => key.length)
    .map(key => ({ publicKey: `${key} github@${username}` }));
}

/**
 * @param {string} organization
 * @returns {Promise<SshKey[]>}
 */
async function getGithubOrgSshKeys(organization) {
  const url = new URL(`orgs/${encodeURIComponent(organization)}/members`, getGithubApiUrl());
  const members = await curlSafe(url, { json: true });

  /** @type {SshKey[][]} */
  const sshKeys = await Promise.all(
    members.filter(({ type, login }) => type === "User" && login).map(({ login }) => getGithubUserSshKeys(login)),
  );

  return sshKeys.flat();
}

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
 * @param {string} hostname
 * @param {string} [username]
 * @param {string} [password]
 * @returns {string}
 */
function getRdpFile(hostname, username) {
  const options = [
    "auto connect:i:1", // start the connection automatically
    `full address:s:${hostname}`,
  ];
  if (username) {
    options.push(`username:s:${username}`);
  }
  return options.join("\n");
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
    case "docker":
      return docker;
    case "aws":
      return aws;
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
      "release": { type: "string" },
      "name": { type: "string" },
      "instance-type": { type: "string" },
      "image-id": { type: "string" },
      "image-name": { type: "string" },
      "cpu-count": { type: "string" },
      "memory-gb": { type: "string" },
      "disk-size-gb": { type: "string" },
      "preemptible": { type: "boolean" },
      "spot": { type: "boolean" },
      "detached": { type: "boolean" },
      "tag": { type: "string", multiple: true },
      "ci": { type: "boolean" },
      "rdp": { type: "boolean" },
      "vnc": { type: "boolean" },
      "feature": { type: "string", multiple: true },
      "user-data": { type: "string" },
      "authorized-user": { type: "string", multiple: true },
      "authorized-org": { type: "string", multiple: true },
      "no-bootstrap": { type: "boolean" },
      "buildkite-token": { type: "string" },
      "tailscale-authkey": { type: "string" },
      "docker": { type: "boolean" },
    },
  });

  const sshKeys = getSshKeys();
  if (args["authorized-user"]) {
    const userSshKeys = await Promise.all(args["authorized-user"].map(getGithubUserSshKeys));
    sshKeys.push(...userSshKeys.flat());
  }
  if (args["authorized-org"]) {
    const orgSshKeys = await Promise.all(args["authorized-org"].map(getGithubOrgSshKeys));
    sshKeys.push(...orgSshKeys.flat());
  }

  const tags = {
    "robobun": "true",
    "robobun2": "true",
    // This tag controls the IAM role required to be able to write to the shared S3 build cache.
    // Don't want accidental polution from non-CI runs.
    "Service": args["ci"] ? "buildkite-agent" : undefined,
    "buildkite:token": args["buildkite-token"],
    "tailscale:authkey": args["tailscale-authkey"],
    ...Object.fromEntries(args["tag"]?.map(tag => tag.split("=")) ?? []),
  };

  const cloud = getCloud(args["cloud"]);

  /** @type {MachineOptions} */
  const options = {
    cloud: args["cloud"],
    os: parseOs(args["os"]),
    arch: parseArch(args["arch"]),
    distro: args["distro"],
    release: args["release"],
    name: args["name"],
    instanceType: args["instance-type"],
    imageId: args["image-id"],
    imageName: args["image-name"],
    tags,
    cpuCount: parseInt(args["cpu-count"]) || undefined,
    memoryGb: parseInt(args["memory-gb"]) || undefined,
    diskSizeGb: parseInt(args["disk-size-gb"]) || void 0,
    preemptible: !!args["preemptible"] || !!args["spot"],
    detached: !!args["detached"],
    bootstrap: args["no-bootstrap"] !== true,
    ci: !!args["ci"],
    features: args["feature"],
    rdp: !!args["rdp"] || !!args["vnc"],
    sshKeys,
    userData: args["user-data"] ? readFile(args["user-data"]) : undefined,
  };

  let { detached, bootstrap, ci, os, arch, distro, release, features } = options;

  let name = `${os}-${arch}-${(release || "").replace(/\./g, "")}`;

  if (distro) {
    name += `-${distro}`;
  }

  if (distro === "alpine") {
    name += `-musl`;
  }

  if (features?.length) {
    name += `-with-${features.join("-")}`;
  }

  let bootstrapPath, agentPath, dockerfilePath;
  if (bootstrap) {
    bootstrapPath = resolve(
      import.meta.dirname,
      os === "windows"
        ? "bootstrap.ps1"
        : features?.includes("docker")
          ? "../.buildkite/Dockerfile-bootstrap.sh"
          : "bootstrap.sh",
    );
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

    if (features?.includes("docker")) {
      dockerfilePath = resolve(import.meta.dirname, "../.buildkite/Dockerfile");

      if (!existsSync(dockerfilePath)) {
        throw new Error(`Dockerfile not found: ${dockerfilePath}`);
      }
    }
  }

  /** @type {Machine} */
  const machine = await startGroup("Creating machine...", async () => {
    console.log("Creating machine:");
    console.table({
      "Operating System": os,
      "Architecture": arch,
      "Distribution": distro ? `${distro} ${release}` : release,
      "CI": ci ? "Yes" : "No",
    });

    const result = await cloud.createMachine(options);
    const { id, name, imageId, instanceType, region, publicIp } = result;
    console.log("Created machine:");
    console.table({
      "ID": id,
      "Name": name || "N/A",
      "Image ID": imageId,
      "Instance Type": instanceType,
      "Region": region,
      "IP Address": publicIp || "TBD",
    });

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
    if (options.rdp) {
      await startGroup("Connecting with RDP...", async () => {
        const { hostname, username, password } = await machine.rdp();

        console.log("You can now connect with RDP using these credentials:");
        console.table({
          Hostname: hostname,
          Username: username,
          Password: password,
        });

        const { cloud, id } = machine;
        const rdpPath = mkdtemp("rdp-", `${cloud}-${id}.rdp`);

        /** @type {string[]} */
        let command;
        if (isMacOS) {
          command = [
            "osascript",
            "-e",
            `'tell application "Microsoft Remote Desktop" to open POSIX file ${JSON.stringify(rdpPath)}'`,
          ];
        }

        if (command) {
          writeFile(rdpPath, getRdpFile(hostname, username));
          await spawn(command, { detached: true });
        }
      });
    }

    await startGroup("Connecting with SSH...", async () => {
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
        if (!features?.includes("docker")) {
          const remotePath = "/tmp/bootstrap.sh";
          const args = ci ? ["--ci"] : [];
          for (const feature of features || []) {
            args.push(`--${feature}`);
          }
          await startGroup("Running bootstrap...", async () => {
            await machine.upload(bootstrapPath, remotePath);
            await machine.spawnSafe(["sh", remotePath, ...args], { stdio: "inherit" });
          });
        } else if (dockerfilePath) {
          const remotePath = "/tmp/bootstrap.sh";

          await startGroup("Running Docker bootstrap...", async () => {
            await machine.upload(bootstrapPath, remotePath);
            console.log("Uploaded bootstrap.sh");
            await machine.upload(dockerfilePath, "/tmp/Dockerfile");
            console.log("Uploaded Dockerfile");
            await machine.upload(agentPath, "/tmp/agent.mjs");
            console.log("Uploaded agent.mjs");
            agentPath = "";
            bootstrapPath = "";
            await machine.spawnSafe(["sudo", "bash", remotePath], { stdio: "inherit", cwd: "/tmp" });
          });
        }
      }
    }

    if (agentPath) {
      if (os === "windows") {
        const remotePath = "C:\\buildkite-agent\\agent.mjs";
        await startGroup("Installing agent...", async () => {
          await machine.upload(agentPath, remotePath);
          if (cloud.name === "docker" || features?.includes("docker")) {
            return;
          }
          await machine.spawnSafe(["node", remotePath, "install"], { stdio: "inherit" });
        });
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
          if (cloud.name === "docker") {
            return;
          }
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
        suffix = `v${getBootstrapVersion(os)}`;
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

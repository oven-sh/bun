import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, parseArgs } from "node:util";
import { azure } from "./azure.mjs";
import { packerDownload } from "./build/ci/artifacts.ts";
import { agentEntry } from "./build/ci/components/paths.ts";
import { LINUX_REMOTE_BOOTSTRAP, LINUX_REMOTE_ROOT, linuxBootstrapCommand } from "./build/ci/delivery.ts";
import { azureToken } from "./build/ci/existence.ts";
import { imageName as computeImageName, imageEntry } from "./build/ci/naming.ts";
import { imageOutDir } from "./build/ci/outputs.ts";
import { packer } from "./build/ci/spec.ts";
import { docker } from "./docker.mjs";
import { tart } from "./tart.mjs";
import {
  $,
  copyFile,
  curlSafe,
  escapePowershell,
  getBranch,
  getGithubApiUrl,
  getGithubUrl,
  getSecret,
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
    throw new Error(`Failed to run instances: ${inspect(options)}`);
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

    // Image names are content-addressed (`${key}-${hash}`), so a name that
    // already exists is the SAME recipe already baked — by another branch or
    // a retried job. Reuse it; never deregister (that would break every
    // branch already pointing at the name).
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

    console.log(`[aws] image "${options["name"]}" already exists (${existingImageId}); reusing it`);
    return existingImageId;
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
    // The base AMI is a fact on the image's spec entry (FLOATING: the newest
    // AMI matching the glob at bake time). CI bakes only spec'd images; ad-hoc
    // `ssh` sessions of other distros must pass --image-id explicitly.
    const entry = options.imageEntry;
    if (entry.os !== "linux") {
      throw new Error(`getBaseImage: ${entry.key} is not a linux/AWS image`);
    }
    const { owner, nameGlob: name } = entry.base;

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

    // The login user is a fact on the spec entry (base.sshUsername).
    const username = options.imageEntry.base.sshUsername;

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
      // Explicit --instance-type wins; otherwise the bake shape is a spec
      // fact (image.bake.instanceType) — not re-declared here.
      ["instance-type"]: instanceType || options.imageEntry.bake.instanceType,
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

/**
 * Build a Windows CI image with Packer (Azure only). Packer handles VM
 * creation, WinRM provisioning, sysprep, and gallery capture. Everything
 * that varies — base image, bake VM, disk, gallery destination, replication
 * regions, the pinned node, the bootstrap command — comes from the image's
 * spec entry via scripts/build/ci/packer.ts, which renders the template as
 * JSON in memory (no checked-in .pkr.hcl). The gallery image definition
 * name (`${key}-${hash}`) and the architecture are derived from `image`.
 *
 * @param {object} options
 * @param {WindowsImage} options.image the spec entry to bake
 * @param {boolean} options.ci
 * @param {string} options.repoRef
 * @param {string} options.agentPath generated, esbuild-bundled agent.mjs
 * @param {string} options.generated build/ci/<key>: generated packer.json + bootstrap.ts
 */
async function buildWindowsImageWithPacker({ image, ci, repoRef, agentPath, generated }) {
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
  const token = await azureToken(tenantId, clientId, clientSecret);

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

  // The Packer template is GENERATED (packer.json, spec-derived values as
  // literal text). Substitute the bake-time placeholders — credentials, the
  // branch ref, local upload paths — which are deliberately outside the
  // image hash, then write the concrete template for this bake.
  const packerBin = await ensurePacker(packer.version);
  const bootstrapFile = join(generated, "bootstrap.ts");
  const substitutions = {
    azure_client_id: clientId,
    azure_client_secret: clientSecret,
    azure_subscription_id: subscriptionId,
    azure_tenant_id: tenantId,
    azure_build_resource_group: `${resourceGroup}-PACKER`,
    azure_location: image.gallery.location,
    repo_ref: repoRef,
    bootstrap_file: bootstrapFile,
    agent_path: agentPath,
    hash: imageName.slice(image.key.length + 1),
  };
  const rendered = readFileSync(join(generated, "packer.json"), "utf8").replace(/\{\{([a-z_]+)\}\}/g, (match, name) => {
    if (!(name in substitutions)) throw new Error(`packer.json placeholder {{${name}}} has no substitution`);
    return String(substitutions[name]).replace(/\\/g, "\\\\");
  });
  const templateDir = mkdtempSync(join(tmpdir(), "packer-"));
  const templatePath = join(templateDir, `${key}.pkr.json`);
  writeFileSync(templatePath, rendered);
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
 * Download and install Packer if not already available, at the version the
 * spec pins for the gallery being built.
 * @param {string} version
 */
async function ensurePacker(version) {
  // Reuse an existing packer only if it is the pinned version; a stale
  // system or cached binary must not shadow the spec pin.
  const isPinned = (bin: string) => spawnSync(bin, ["version"], { encoding: "utf8" }).stdout.includes(`v${version}`);
  const packerPath = which("packer");
  if (packerPath && isPinned(packerPath)) {
    console.log("[packer] Found:", packerPath);
    return packerPath;
  }
  const localPacker = join(tmpdir(), "packer");
  if (existsSync(localPacker) && isPinned(localPacker)) {
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
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
  });

  const [command] = positionals;
  if (!/^(ssh|create-image)$/.test(command)) {
    const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
    throw new Error(`Usage: ./${scriptPath} [ssh|create-image] [options]`);
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
      "image": { type: "string" },
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

  // The spec image entry this run is about: named exactly by --image (the
  // spec key). ci.mjs passes it; nothing here reverse-engineers a key from
  // os/arch/distro/release (that reconstruction can't recover abi/features).
  const imageKeyFlag = args["image"];
  if (!imageKeyFlag) {
    throw new Error(`--image=<key> is required (a key from scripts/build/ci/spec.ts)`);
  }
  const imageEntryValue = imageEntry(imageKeyFlag);

  /** @type {MachineOptions} */
  const options = {
    imageEntry: imageEntryValue,
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
    rdp: !!args["rdp"] || !!args["vnc"],
    sshKeys,
    userData: args["user-data"] ? readFile(args["user-data"]) : undefined,
  };

  let { detached, bootstrap, ci, os, arch, distro, release } = options;
  // Windows spec images exist only on Azure and are baked end-to-end by
  // Packer (create-image --cloud=azure). This tool has no live-Windows
  // machine path — refuse up front with the reason, instead of accepting the
  // request and failing deep inside base-image lookup.
  if (options.imageEntry && options.imageEntry.os === "windows" && command === "ssh") {
    throw new Error(
      `Windows CI images live in Azure and are baked by Packer; there is no interactive ` +
        `Windows machine path in machine.ts. To bake ${options.imageEntry.key}: ` +
        `create-image --image=${options.imageEntry.key} --cloud=azure`,
    );
  }

  // create-image bakes options.imageEntry (from --image). The image name is
  // COMPUTED from the entry (`${key}-${hash}`) — never taken from the command
  // line — so what gets baked can only be named what the spec says it is.
  // --image-name remains only the pre-existing "boot an existing AMI" input
  // (options.imageName, used by createMachine's image lookup).
  const bakeName = options.ci ? computeImageName(imageEntryValue) : undefined;

  // Tell bootstrap which ref of the repo to shallow-clone for the prefetch
  // caches — the dep version pins live in scripts/build/deps/ and aren't
  // uploaded with bootstrap. Pinning to the triggering branch means a PR
  // that bumps a dep also bakes the new tarball into the image it builds.
  // The value reaches a remote shell, so reject anything outside the
  // git-ref character set rather than try to quote it. A non-matching branch
  // (or no branch detected) falls back to main.
  const branch = getBranch();
  const repoRef = branch && /^[\w./-]+$/.test(branch) ? branch : "main";

  // The image's files are GENERATED by the build (bun scripts/build.ts →
  // scripts/build/ci/generate.ts) into build/ci/<key>/: the self-contained
  // bootstrap.ts, the agent bundle, and (windows) the packer template. This
  // orchestrator only consumes them — the bytes uploaded are the bytes the
  // image name is a hash of.
  const generated = bootstrap ? imageOutDir(imageEntryValue) : undefined;
  if (generated && !existsSync(join(generated, "bootstrap.ts"))) {
    throw new Error(
      `no generated files for "${imageEntryValue.key}" at ${generated}\n` + `Run \`bun scripts/build.ts\` first.`,
    );
  }
  const bootstrapFile = generated ? join(generated, "bootstrap.ts") : undefined;
  const agentPath = generated && ci ? join(generated, "agent.mjs") : undefined;
  if (generated) console.log("Generated image files:", generated);

  // Use Packer for Windows Azure image builds — it handles VM creation,
  // bootstrap, sysprep, and gallery capture via WinRM (no Run Command hacks).
  // Its idempotency check (gallery version probe) is inside the function.
  if (args["cloud"] === "azure" && os === "windows" && command === "create-image") {
    await buildWindowsImageWithPacker({ image: options.imageEntry, ci, repoRef, agentPath, generated });
    return;
  }

  // Idempotent by name on AWS, same shape as the Azure path: one cheap
  // describe-images by exact name BEFORE launching anything. Same name means
  // the identical recipe already baked (another branch, or a retried job),
  // so there is nothing to do — no bake VM, no hour of bootstrap.
  if (command === "create-image" && bakeName) {
    const [existing] = await aws.describeImages({ "state": "available", "name": bakeName });
    if (existing) {
      console.log(`[aws] ${bakeName} already exists (${existing.ImageId}); reusing (nothing to bake)`);
      return;
    }
    console.log(`[aws] ${bakeName} does not exist yet; baking it`);
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

    await startGroup(`Connecting${options.cloud === "azure" ? "" : " with SSH"}...`, async () => {
      const command = os === "windows" ? ["cmd", "/c", "ver"] : ["uname", "-a"];
      await machine.spawnSafe(command, { stdio: "inherit" });
    });

    if (bootstrapFile) {
      // (Windows never reaches here: main turns bootstrap off for it — the
      // Packer path bakes Windows images.)
      // The image entry the bootstrap builds (resolved from --image in main).
      const entry = options.imageEntry;
      await startGroup("Uploading the generated bootstrap...", async () => {
        await machine.spawnSafe(["sh", "-c", `rm -rf ${LINUX_REMOTE_ROOT} && mkdir -p ${LINUX_REMOTE_ROOT}`]);
        await machine.upload(bootstrapFile, LINUX_REMOTE_BOOTSTRAP);
        await machine.spawnSafe(["ls", "-l", LINUX_REMOTE_ROOT]);
      });
      await startGroup("Running bootstrap...", async () => {
        // Renders: fetch the spec-pinned node, then `node bootstrap.ts`.
        // The script is the SOLE remote argument: ssh space-joins trailing
        // args before the remote shell parses them, so ["sh","-c",script]
        // would run `sh -c set` (a var dump) and then the body in the outer
        // shell WITHOUT its `set -ex`. sshd already runs the argument under
        // `$SHELL -c`, so one string keeps set -e (abort on failure) and
        // set -x (echo every command) intact.
        const script = linuxBootstrapCommand(entry, { ci, repoRef });
        await machine.spawnSafe([script], { stdio: "inherit" });
      });
    }

    // Windows agents are installed inside the Packer bake (packer.ts). For
    // linux, upload the bundled agent to the spec'd path and run its
    // `install` command to write the systemd/openrc unit.
    if (agentPath) {
      {
        const tmpPath = "/tmp/agent.mjs";
        const remotePath = agentEntry(options.imageEntry);
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
          // Bootstrap installed the spec-pinned node; the agent runs under it.
          command.push("node");
          await machine.spawnSafe([...command, remotePath, "install"], { stdio: "inherit" });
        });
      }
    }

    if (command === "create-image") {
      // Content-addressed: `${key}-${hash}` computed from the spec entry.
      // There are no version numbers or build-number suffixes; a non-CI
      // local bake gets a draft name so it can't shadow a real image.
      const label = bakeName ?? `${options.imageEntry.key}-draft-${Date.now()}`;
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

// Run only when executed as the entry point (node scripts/machine.mjs …),
// not when the module is imported for its types (e.g. azure.mjs's JSDoc).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main();
}

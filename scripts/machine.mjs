#!/usr/bin/env node

import { inspect, parseArgs } from "node:util";
import {
  $,
  curlSafe,
  getArch,
  getDistro,
  getSecret,
  isCI,
  isLinux,
  isMacOS,
  readFile,
  spawn,
  spawnSafe,
  spawnSyncSafe,
  tmpdir,
  waitForPort,
  which,
} from "./utils.mjs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";

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

    const exec = async command => {
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
      exec,
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
   * @returns {Promise<any>}
   */
  async spawn(args) {
    const aws = which("aws");
    if (!aws) {
      if (isMacOS) {
        await spawnSafe(["brew", "install", "awscli"]);
      } else {
        throw new Error("AWS CLI is not installed, please install it");
      }
    }

    let env;
    if (isCI) {
      env = {
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID", { required: true }),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY", { required: true }),
        AWS_REGION: getSecret("EC2_REGION", { required: false }) || "us-east-1",
      };
    }

    const { stdout } = await spawnSafe($`${aws} ${args} --output json`, { env });
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

    const label = `${os}-${arch}-${distro}-${distroVersion || "*"}`;
    const ownedImages = await aws.describeImages({
      "owner-alias": "self",
      "name": label,
    });

    if (ownedImages.length) {
      const [image] = ownedImages;
      return aws.getAvailableImage(image);
    }

    let name, owner;
    if (os === "linux") {
      if (!distro || distro === "debian") {
        owner = "amazon";
        name = `debian-${distroVersion || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-*`;
      } else if (distro === "ubuntu") {
        owner = "amazon";
        name = `ubuntu/images/hvm-ssd/ubuntu-*-${distroVersion || "*"}-${arch === "aarch64" ? "arm64" : "amd64"}-server-*`;
      } else if (distro === "amazonlinux") {
        owner = "amazon";
        if (distroVersion === "1") {
          // EOL
        } else if (distroVersion === "2") {
          name = `amzn2-ami-hvm-*-${arch === "aarch64" ? "arm64" : "x86_64"}-gp2`;
        } else {
          name = `al${distroVersion || "*"}-ami-*-${arch === "aarch64" ? "arm64" : "x86_64"}`;
        }
      } else if (distro === "alpine") {
        owner = "538276064493";
        name = `alpine-${distroVersion || "*"}.*-${arch === "aarch64" ? "aarch64" : "x86_64"}-uefi-cloudinit-*`;
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
    const { arch, imageId, instanceType, metadata } = options;

    /** @type {AwsImage} */
    let image;
    if (imageId) {
      image = await aws.getAvailableImage(imageId);
    } else {
      image = await aws.getBaseImage(options, true);
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
    const userData = getCloudInit({ ...options, username });

    let tagSpecification = [];
    if (metadata) {
      tagSpecification = ["instance", "volume"].map(resourceType => {
        return {
          ResourceType: resourceType,
          Tags: Object.entries(metadata).map(([Key, Value]) => ({ Key, Value })),
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

    return aws.toMachine(instance, username);
  },

  /**
   * @param {AwsInstance} instance
   * @param {string} [username]
   * @returns {Machine}
   */
  toMachine(instance, username) {
    let { InstanceId, ImageId, InstanceType, Placement, PublicIpAddress } = instance;

    const connect = async () => {
      if (!PublicIpAddress) {
        await aws.waitInstances("instance-running", InstanceId);
        const [{ PublicIpAddress: IpAddress }] = await aws.describeInstances({
          ["instance-id"]: InstanceId,
        });
        PublicIpAddress = IpAddress;
      }

      return { hostname: PublicIpAddress, username };
    };

    const exec = async (command, options) => {
      const connectOptions = await connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const attach = async () => {
      const connectOptions = await connect();
      await spawnSsh({ ...connectOptions });
    };

    const upload = async (source, destination) => {
      const connectOptions = await connect();
      await spawnScp({ ...connectOptions, source, destination });
    };

    const snapshot = async () => {
      await aws.stopInstances(InstanceId);
      await aws.waitInstances("instance-stopped", InstanceId);
      const imageId = await aws.createImage({
        ["instance-id"]: InstanceId,
        ["name"]: `${InstanceId}-snapshot-${Date.now()}`,
      });
      await aws.waitImage("image-available", imageId);
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
      exec,
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

    const exec = command => {
      const hostname = publicIp();
      return spawnSsh({ hostname, username, command });
    };

    const attach = async () => {
      const hostname = publicIp();
      await spawnSsh({ hostname, username });
    };

    const terminate = async () => {
      await google.deleteInstance(id);
    };

    return {
      exec,
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
 * @property {string[]} [authorizedKeys]
 * @property {string} [username]
 * @property {string} [password]
 */

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
 */
function getCloudInit(cloudInit) {
  const username = cloudInit["username"] || "root";
  const password = cloudInit["password"] || crypto.randomUUID();
  const authorizedKeys = JSON.stringify(cloudInit["authorizedKeys"] || []);

  let sftpPath = "/usr/lib/openssh/sftp-server";
  switch (cloudInit["distro"]) {
    case "alpine":
      sftpPath = "/usr/lib/ssh/sftp-server";
      break;
    case "amazon":
      sftpPath = "/usr/libexec/openssh/sftp-server";
      break;
  }

  // https://cloudinit.readthedocs.io/en/stable/
  return `#cloud-config

    package_update: true
    packages:
      - curl
      - ca-certificates
      - openssh-server
    
    write_files:
      - path: /etc/ssh/sshd_config
        content: |
          PermitRootLogin yes
          PasswordAuthentication yes
          Subsystem sftp ${sftpPath}

    chpasswd:
      expire: false
      list: |
        root:${password}
        ${username}:${password}

    disable_root: false

    ssh_pwauth: true
    ssh_authorized_keys: ${authorizedKeys}
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

  if (/alpine/i.test(distro)) {
    return "root";
  }

  if (/debian/i.test(distro)) {
    return "admin";
  }

  if (/ubuntu/i.test(distro)) {
    return "ubuntu";
  }

  if (/amazon|amzn/i.test(distro)) {
    return "ec2-user";
  }

  throw new Error(`Unsupported distro: ${distro}`);
}

/**
 * @param {MachineOptions} options
 * @returns {number}
 */
function getDiskSize(options) {
  const { os, diskSize } = options;

  if (diskSize) {
    return diskSize;
  }

  return os === "windows" ? 50 : 30;
}

/**
 * @returns {string}
 */
function generateSshKey() {
  const sshPath = join(homedir(), ".ssh");
  if (!existsSync(sshPath)) {
    mkdirSync(sshPath, { recursive: true });
  }

  const name = `id_rsa_${crypto.randomUUID()}`;
  const privateKeyPath = join(sshPath, name);
  const publicKeyPath = join(sshPath, `${name}.pub`);
  spawnSyncSafe($`ssh-keygen -t rsa -b 4096 -f ${privateKeyPath} -N ""`, { stdio: "inherit" });

  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    throw new Error(`Failed to generate SSH key: ${privateKeyPath} / ${publicKeyPath}`);
  }

  const configPath = join(sshPath, "config");
  const config = `
Host *
  IdentityFile ${privateKeyPath}
  AddKeysToAgent yes
`;
  appendFileSync(configPath, config);

  return readFile(publicKeyPath);
}

/**
 * @returns {string[]}
 */
function getSshKeys() {
  const homePath = homedir();
  const sshPath = join(homePath, ".ssh");

  let sshKeys = [];
  if (existsSync(sshPath)) {
    const sshFiles = readdirSync(sshPath, { withFileTypes: true });
    const sshPaths = sshFiles
      .filter(entry => entry.isFile() && entry.name.endsWith(".pub"))
      .map(({ name }) => join(sshPath, name));

    sshKeys = sshPaths
      .map(path => readFile(path, { cache: true }))
      .map(key => key.split(" ").slice(0, 2).join(" "))
      .filter(key => key.length);
  }

  if (!sshKeys.length) {
    sshKeys.push(generateSshKey());
  }

  return sshKeys;
}

/**
 * @param {string} organization
 * @returns {Promise<string[]>}
 */
async function getGithubAuthorizedKeys(organization) {
  const members = await curlSafe(`https://api.github.com/orgs/${organization}/members`, { json: true });
  const sshKeys = await Promise.all(
    members.map(async ({ login }) => {
      const publicKeys = await curlSafe(`https://github.com/${login}.keys`);
      return publicKeys
        .split("\n")
        .map(key => key.trim())
        .filter(key => key.length);
    }),
  );

  return sshKeys.flat();
}

/**
 * @typedef SshOptions
 * @property {string} hostname
 * @property {number} [port]
 * @property {string} [username]
 * @property {string[]} [command]
 * @property {number} [retries]
 */

/**
 * @param {SshOptions} options
 * @param {object} [spawnOptions]
 * @returns {Promise<void>}
 */
async function spawnSsh(options, spawnOptions = {}) {
  const { hostname, port, username, command, retries = 1 } = options;
  await waitForPort({ hostname, port: port || 22 });

  const ssh = ["ssh", hostname, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    ssh.push("-p", port);
  }
  if (username) {
    ssh.push("-l", username);
  }
  const stdio = command ? "pipe" : "inherit";
  if (command) {
    ssh.push(...command);
  }

  let cause;
  for (let i = 0; i < retries; i++) {
    const result = await spawn(ssh, { stdio, ...spawnOptions });
    const { exitCode, stderr } = result;
    if (exitCode === 0) {
      return;
    }

    cause = stderr.trim() || undefined;
    if (/bad configuration option/i.test(stderr)) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  throw new Error(`SSH failed: ${username}@${hostname}`, { cause });
}

/**
 * @typedef ScpOptions
 * @property {string} hostname
 * @property {string} source
 * @property {string} destination
 * @property {string} [port]
 * @property {string} [username]
 * @property {number} [retries]
 */

/**
 * @param {ScpOptions} options
 * @returns {Promise<void>}
 */
async function spawnScp(options) {
  const { hostname, port, username, source, destination, retries = 10 } = options;
  await waitForPort({ hostname, port: port || 22 });

  const command = ["scp", "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    command.push("-P", port);
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
 * @typedef Machine
 * @property {string} cloud
 * @property {string} [name]
 * @property {string} id
 * @property {string} imageId
 * @property {string} instanceType
 * @property {string} region
 * @property {string} [publicIp]
 * @property {(command: string[]) => Promise<SpawnResult>} exec
 * @property {(source: string, destination: string) => Promise<void>} upload
 * @property {() => Promise<void>} attach
 * @property {() => Promise<void>} snapshot
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {"aws" | "docker" | "google"} Cloud
 * @typedef {"linux" | "darwin" | "windows"} Os
 * @typedef {"aarch64" | "x64"} Arch
 */

/**
 * @typedef MachineOptions
 * @property {Cloud} cloud
 * @property {Os} os
 * @property {Arch} arch
 * @property {string} distro
 * @property {Record<string, string | undefined>} [metadata]
 * @property {string} [distroVersion]
 * @property {string} [instanceType]
 * @property {string} [imageId]
 * @property {number} [diskSize]
 */

/**
 * @param {string[]} args
 * @returns {MachineOptions}
 */
function parseOptions(args) {
  const { values: options, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "cloud": { type: "string", default: "docker" },
      "os": { type: "string", default: "linux" },
      "arch": { type: "string", default: getArch() },
      "distro": { type: "string", default: "debian" },
      "distro-version": { type: "string" },
      "instance-type": { type: "string" },
      "image-id": { type: "string" },
      "disk-size": { type: "string" },
      "buildkite-token": { type: "string" },
    },
  });

  return {
    ...options,
    distroVersion: options["distro-version"],
    instanceType: options["instance-type"],
    imageId: options["image-id"],
    diskSize: parseInt(options["disk-size"]) || undefined,
    buildkiteToken: options["buildkite-token"],
    command: positionals.length ? positionals : undefined,
  };
}

async function main() {
  const { command, buildkiteToken, ...options } = parseOptions(process.argv.slice(2));
  const authorizedKeys = getSshKeys();

  let cloud;
  if (options["cloud"] === "docker") {
    cloud = docker;
  } else if (options["cloud"] === "aws") {
    cloud = aws;
  } else if (options["cloud"] === "google") {
    cloud = google;
  } else {
    throw new Error(`Unsupported cloud: ${inspect(options)}`);
  }

  let metadata;
  if (buildkiteToken) {
    metadata = {
      "buildkite:token": buildkiteToken,
    };
  }

  const machine = await cloud.createMachine({ ...options, authorizedKeys, metadata });
  console.log("Created machine:", machine);

  process.on("SIGINT", () => {
    machine.close().finally(() => process.exit(1));
  });

  const doTest = async () => {
    await machine.exec(["uname", "-a"], { stdio: "inherit" });
  };

  const doBootstrap = async (ci = true) => {
    const localPath = resolve(import.meta.dirname, "bootstrap.sh");
    const remotePath = "/tmp/bootstrap.sh";
    await machine.upload(localPath, remotePath);
    await machine.exec(["sh", remotePath, ci ? "--ci" : "--no-ci"], { stdio: "inherit" });
  };

  const doAgent = async (action = "install") => {
    const templatePath = resolve(import.meta.dirname, "agent.mjs");
    const tmpPath = mkdtempSync(join(tmpdir(), "agent-"));
    const localPath = join(tmpPath, "agent.mjs");
    const remotePath = "/tmp/agent.mjs";
    await spawnSafe($`bunx esbuild ${templatePath} --bundle --platform=node --format=esm --outfile=${localPath}`);
    await machine.upload(localPath, remotePath);
    await machine.exec(["node", remotePath, action], { stdio: "inherit" });
  };

  try {
    await doTest();
    await doBootstrap();
    await doAgent();
  } catch (error) {
    if (isCI) {
      throw error;
    } else {
      console.error(error);
      try {
        await machine.attach();
      } catch (error) {
        console.error(error);
      }
    }
  } finally {
    await machine.close();
  }
}

await main();

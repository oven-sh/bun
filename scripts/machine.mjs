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
  getGithubUrl,
  getGithubApiUrl,
  curlSafe,
  mkdtemp,
  writeFile,
  copyFile,
  isMacOS,
  mkdir,
  rm,
  homedir,
  isWindows,
  sha256,
} from "./utils.mjs";
import { basename, extname, join, relative, resolve } from "node:path";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
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
    const { os, arch, imageId, instanceType, tags, sshKeys, preemptible } = options;

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
    });

    return aws.toMachine(instance, { ...options, username, keyPath });
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
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },
};

export const google = {
  get cloud() {
    return "google";
  },

  /**
   * @param {string[]} args
   * @param {import("./utils.mjs").SpawnOptions} [options]
   * @returns {Promise<unknown>}
   */
  async spawn(args, options = {}) {
    const gcloud = which("gcloud", { required: true });

    let env;
    if (isCI) {
      env = {}; // TODO: Add Google Cloud credentials
    }

    const { stdout } = await spawnSafe($`${gcloud} ${args} --format json`, { env, ...options });
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
    const filter = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [value.includes("*") ? `${key}~${value}` : `${key}=${value}`])
      .join(" AND ");
    return filter ? ["--filter", filter] : [];
  },

  /**
   * @param {Record<string, string | boolean | undefined>} options
   * @returns {string[]}
   */
  getFlags(options) {
    return Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .flatMap(([key, value]) => {
        if (typeof value === "boolean") {
          return value ? [`--${key}`] : [];
        }
        return [`--${key}=${value}`];
      });
  },

  /**
   * @param {Record<string, string | boolean | undefined>} options
   * @returns {string}
   * @link https://cloud.google.com/sdk/gcloud/reference/topic/escaping
   */
  getMetadata(options) {
    const delimiter = Math.random().toString(36).substring(2, 15);
    const entries = Object.entries(options)
      .map(([key, value]) => `${key}=${value}`)
      .join(delimiter);
    return `^${delimiter}^${entries}`;
  },

  /**
   * @param {string} name
   * @returns {string}
   */
  getLabel(name) {
    return name.replace(/[^a-z0-9_-]/g, "-").toLowerCase();
  },

  /**
   * @typedef {Object} GoogleImage
   * @property {string} id
   * @property {string} name
   * @property {string} family
   * @property {"X86_64" | "ARM64"} architecture
   * @property {string} diskSizeGb
   * @property {string} selfLink
   * @property {"READY"} status
   * @property {string} creationTimestamp
   */

  /**
   * @param {Partial<GoogleImage>} [options]
   * @returns {Promise<GoogleImage[]>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/images/list
   */
  async listImages(options) {
    const filters = google.getFilters(options);
    const images = await google.spawn($`compute images list ${filters} --preview-images --show-deprecated`);
    return images.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  /**
   * @param {Record<string, string | boolean | undefined>} options
   * @returns {Promise<GoogleImage>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/images/create
   */
  async createImage(options) {
    const { name, ...otherOptions } = options;
    const flags = this.getFlags(otherOptions);
    const imageId = name || "i-" + Math.random().toString(36).substring(2, 15);
    return this.spawn($`compute images create ${imageId} ${flags}`);
  },

  /**
   * @typedef {Object} GoogleInstance
   * @property {string} id
   * @property {string} name
   * @property {"RUNNING"} status
   * @property {string} machineType
   * @property {string} zone
   * @property {{}[]} networkInterfaces
   * @property {string} selfLink
   * @property {string} creationTimestamp
   */

  /**
   * @param {Partial<GoogleInstance>} options
   * @returns {Promise<GoogleInstance[]>}
   */
  async listInstances(options) {
    const filters = this.getFilters(options);
    const instances = await this.spawn($`compute instances list ${filters}`);
    return instances.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  /**
   * @param {Record<string, string | boolean | undefined>} options
   * @returns {Promise<GoogleInstance>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/instances/create
   */
  async createInstance(options) {
    const { name, ...otherOptions } = options || {};
    const flags = this.getFlags(otherOptions);
    const instanceId = name || "i-" + Math.random().toString(36).substring(2, 15);
    const [instance] = await this.spawn($`compute instances create ${instanceId} ${flags}`);
    return instance;
  },

  /**
   * @param {string} instanceId
   * @param {string} zoneId
   * @returns {Promise<void>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/instances/stop
   */
  async stopInstance(instanceId, zoneId) {
    await this.spawn($`compute instances stop ${instanceId} --zone=${zoneId}`);
  },

  /**
   * @param {string} instanceId
   * @param {string} zoneId
   * @returns {Promise<void>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/instances/delete
   */
  async deleteInstance(instanceId, zoneId) {
    await this.spawn($`compute instances delete ${instanceId} --delete-disks=all --zone=${zoneId}`, {
      throwOnError: error => !/not found/i.test(inspect(error)),
    });
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<GoogleImage>}
   */
  async getMachineImage(options) {
    const { os, arch, distro, distroVersion } = options;
    const architecture = arch === "aarch64" ? "ARM64" : "X86_64";

    /** @type {string | undefined} */
    let family;
    if (os === "linux") {
      if (!distro || distro === "debian") {
        family = `debian-${distroVersion || "*"}`;
      } else if (distro === "ubuntu") {
        family = `ubuntu-${distroVersion?.replace(/\./g, "") || "*"}`;
      } else if (distro === "fedora") {
        family = `fedora-coreos-${distroVersion || "*"}`;
      } else if (distro === "rhel") {
        family = `rhel-${distroVersion || "*"}`;
      }
    } else if (os === "windows" && arch === "x64") {
      if (!distro || distro === "server") {
        family = `windows-${distroVersion || "*"}`;
      }
    }

    if (family) {
      const images = await this.listImages({ family, architecture });
      if (images.length) {
        const [image] = images;
        return image;
      }
    }

    throw new Error(`Unsupported platform: ${inspect(options)}`);
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<Machine>}
   */
  async createMachine(options) {
    const { os, arch, distro, instanceType, tags, preemptible, detached } = options;
    const image = await google.getMachineImage(options);

    const username = getUsername(distro || os);
    const userData = getUserData({ ...options, username });

    /** @type {Record<string, string>} */
    let metadata;
    if (os === "windows") {
      metadata = {
        "sysprep-specialize-script-cmd":
          "googet -noconfirm=true install google-compute-engine-ssh,enable-windows-ssh=TRUE",
        "windows-startup-script-ps1": userData,
      };
    } else {
      metadata = {
        "user-data": userData,
      };
    }

    const instance = await google.createInstance({
      "zone": "us-central1-a",
      "image": image.selfLink,
      "machine-type": instanceType || (arch === "aarch64" ? "t2a-standard-2" : "t2d-standard-2"),
      "boot-disk-auto-delete": true,
      "boot-disk-size": `${getDiskSize(options)}GB`,
      "metadata": this.getMetadata(metadata),
      "labels": Object.entries(tags || {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${this.getLabel(key)}=${value}`)
        .join(","),
      "provisioning-model": preemptible ? "SPOT" : "STANDARD",
      "instance-termination-action": preemptible || !detached ? "DELETE" : undefined,
      "no-restart-on-failure": true,
      "threads-per-core": 1,
      "max-run-duration": detached ? undefined : "6h",
    });

    const { id: instanceId, zone: zoneId, machineType, name } = instance;

    const connect = () => {
      const { networkInterfaces } = instance;
      for (const { accessConfigs } of networkInterfaces) {
        for (const { natIP } of accessConfigs) {
          return {
            hostname: natIP,
            username,
          };
        }
      }
      throw new Error(`Failed to find public IP for instance: ${name}`);
    };

    const spawn = async (command, options) => {
      const connectOptions = connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const spawnSafe = async (command, options) => {
      const connectOptions = connect();
      return spawnSshSafe({ ...connectOptions, command }, options);
    };

    const attach = async () => {
      const connectOptions = connect();
      await spawnSshSafe({ ...connectOptions });
    };

    const upload = async (source, destination) => {
      const connectOptions = connect();
      await spawnScp({ ...connectOptions, source, destination });
    };

    const snapshot = async name => {
      const stopResult = await this.stopInstance(instanceId, zoneId);
      console.log(stopResult);
      const image = await this.createImage({
        ["source-disk"]: instanceId,
        ["zone"]: zoneId,
        ["name"]: name || `${instanceId}-snapshot-${Date.now()}`,
      });
      console.log(image);
      return;
    };

    let terminated = false;

    const terminate = async () => {
      if (!terminated) {
        terminated = true;
        await google.deleteInstance(instanceId, zoneId);
      }
    };

    return {
      cloud: "google",
      id: instanceId,
      name,
      instanceType: machineType.split("/").pop(),
      region: zoneId.split("/").pop(),
      spawn,
      spawnSafe,
      attach,
      upload,
      snapshot,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<MachineImage>}
   */
  async getImage(options) {
    const { os, arch, distro, release } = options;
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
};

/**
 * @typedef CloudInit
 * @property {string} [distro]
 * @property {SshKey[]} [sshKeys]
 * @property {string} [username]
 * @property {string} [password]
 */

/**
 * @param {CloudInit} cloudInit
 * @returns {string}
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
          UsePAM yes
          UseLogin yes
          Subsystem sftp ${sftpPath}
    chpasswd:
      expire: false
      list: ${JSON.stringify(users)}
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

  // After Visual Studio and dependencies are installed,
  // there is ~50GB of used disk space.
  if (os === "windows") {
    return 60;
  }

  return 30;
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
 * @property {string[]} [command]
 * @property {string[]} [identityPaths]
 * @property {number} [retries]
 */

/**
 * @param {SshOptions} options
 * @param {import("./utils.mjs").SpawnOptions} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
async function spawnSsh(options, spawnOptions = {}) {
  const { hostname, port, username, identityPaths, retries = 10, command: spawnCommand } = options;

  await waitForPort({
    hostname,
    port: port || 22,
  });

  const logPath = mkdtemp("ssh-", "ssh.log");
  const command = ["ssh", hostname, "-v", "-C", "-E", logPath, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes"];
  if (port) {
    command.push("-p", port);
  }
  if (username) {
    command.push("-l", username);
  }
  if (identityPaths) {
    command.push(...identityPaths.flatMap(path => ["-i", path]));
  }
  const stdio = spawnCommand ? "pipe" : "inherit";
  if (spawnCommand) {
    command.push(...spawnCommand);
  }

  /** @type {import("./utils.mjs").SpawnResult} */
  let result;
  for (let i = 0; i < retries; i++) {
    result = await spawn(command, { stdio, ...spawnOptions, throwOnError: undefined });

    const { exitCode } = result;
    if (exitCode !== 255) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  const { error } = result;
  if (error) {
    console.warn("SSH logs:", readFile(logPath, { encoding: "utf-8" }));
  }

  return result;
}

/**
 * @param {SshOptions} options
 * @param {import("./utils.mjs").SpawnOptions} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
async function spawnSshSafe(options, spawnOptions = {}) {
  return spawnSsh(options, { throwOnError: true, ...spawnOptions });
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
    case "aws":
      return aws;
    case "google":
      return google;
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
 * @property {(command: string[], options?: import("./utils.mjs").SpawnOptions) => Promise<import("./utils.mjs").SpawnResult>} spawn
 * @property {(command: string[], options?: import("./utils.mjs").SpawnOptions) => Promise<import("./utils.mjs").SpawnResult>} spawnSafe
 * @property {(source: string, destination: string) => Promise<void>} upload
 * @property {() => Promise<RdpCredentials>} [rdp]
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
      "distro-version": { type: "string" },
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
      "authorized-user": { type: "string", multiple: true },
      "authorized-org": { type: "string", multiple: true },
      "no-bootstrap": { type: "boolean" },
      "buildkite-token": { type: "string" },
      "tailscale-authkey": { type: "string" },
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
    "buildkite:token": args["buildkite-token"],
    "tailscale:authkey": args["tailscale-authkey"],
    ...Object.fromEntries(args["tag"]?.map(tag => tag.split("=")) ?? []),
  };

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
    tags,
    cpuCount: parseInt(args["cpu-count"]) || undefined,
    memoryGb: parseInt(args["memory-gb"]) || undefined,
    diskSizeGb: parseInt(args["disk-size-gb"]) || undefined,
    preemptible: !!args["preemptible"] || !!args["spot"],
    detached: !!args["detached"],
    bootstrap: args["no-bootstrap"] !== true,
    ci: !!args["ci"],
    rdp: !!args["rdp"],
    sshKeys,
  };

  const { cloud, detached, bootstrap, ci, os, arch, distro, distroVersion } = options;
  const name = distro ? `${os}-${arch}-${distro}-${distroVersion}` : `${os}-${arch}-${distroVersion}`;

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
    console.log("Creating machine:");
    console.table({
      "Operating System": os,
      "Architecture": arch,
      "Distribution": distro ? `${distro} ${distroVersion}` : distroVersion,
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
        const remotePath = "C:\\buildkite-agent\\agent.mjs";
        await startGroup("Installing agent...", async () => {
          await machine.upload(agentPath, remotePath);
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

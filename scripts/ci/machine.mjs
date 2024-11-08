#!/usr/bin/env bun

import { inspect, parseArgs } from "node:util";
import { getUserData } from "./user-data.mjs";
import { spawn, spawnSafe } from "../utils.mjs";

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
    const { os, distro, release } = platform;

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

const aws = {
  async createMachine(platform) {
    const image = await aws.getImage(platform);
    const userData = await getUserData({ ...platform, username: image["username"] });
    const { id, username, RootDeviceName, BlockDeviceMappings } = image;
    const { os, arch, type } = platform;

    const blockDeviceMappings = BlockDeviceMappings.map(device => {
      const { DeviceName } = device;
      if (DeviceName === RootDeviceName) {
        return {
          ...device,
          Ebs: {
            VolumeSize: os === "windows" ? 40 : 20,
          },
        };
      }
      return device;
    });

    const instanceType = type || (arch === "aarch64" ? "t4g.large" : "t3.large");
    const [instance] = await aws.runInstances(
      {
        ["image-id"]: id,
        ["instance-type"]: instanceType,
        ["user-data"]: userData,
        ["block-device-mappings"]: JSON.stringify(blockDeviceMappings),
        ["metadata-options"]: JSON.stringify({
          "HttpTokens": "optional",
          "HttpEndpoint": "enabled",
          "HttpProtocolIpv6": "enabled",
          "InstanceMetadataTags": "enabled",
        }),
      },
      {
        wait: true,
      },
    );

    const { InstanceId, PublicIpAddress } = instance;
    const options = { hostname: PublicIpAddress, username };

    const exec = command => {
      return spawnSsh({ ...options, command });
    };

    const attach = async () => {
      await spawnSsh({ ...options });
    };

    const terminate = async () => {
      await aws.terminateInstances(InstanceId);
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
    const armOrAmd = arch === "aarch64" ? "arm64" : "amd64";
    const armOr64 = arch === "aarch64" ? "arm64" : "x86_64";
    const aarchOr64 = arch === "aarch64" ? "aarch64" : "x86_64";

    let name;
    let username;
    let owner = "amazon";
    if (os === "linux") {
      if (distro === "debian") {
        name = `debian-${release}-${armOrAmd}-*`;
        username = "admin";
      } else if (distro === "ubuntu") {
        name = `ubuntu/images/hvm-ssd/ubuntu-*-${release}-${armOrAmd}-server-*`;
        username = "ubuntu";
      } else if (distro === "amazonlinux") {
        username = "ec2-user";
        if (release === "1") {
          // EOL
        } else if (release === "2") {
          name = `amzn2-ami-hvm-*-${armOr64}-gp2`;
        } else {
          name = `al${release}-ami-*-${armOr64}`;
        }
      } else if (distro === "alpine") {
        owner = undefined;
        name = `alpine-${release}.*-${aarchOr64}-uefi-cloudinit-*`;
        username = "root";
      }
    } else if (os === "windows") {
      if (distro === "server") {
        name = `Windows_Server-${release}-English-Full-Base-*`;
        username = "Administrator";
      }
    }

    if (name && username) {
      const images = await aws.describeImages({ state: "available", "owner-alias": owner, name });
      if (images.length) {
        const [image] = images;
        const { Name, ImageId, RootDeviceName, BlockDeviceMappings } = image;
        return {
          id: ImageId,
          name: Name,
          username,
          RootDeviceName,
          BlockDeviceMappings,
        };
      }
    }

    throw new Error(`Unsupported image: ${inspect(platform)}`);
  },

  async describeImages(options = {}) {
    const filters = Object.entries(options)
      .filter(([_, value]) => value)
      .map(([key, value]) => `Name=${key},Values=${value}`);
    const { stdout } = await spawnSafe(["aws", "ec2", "describe-images", "--filters", ...filters, "--output", "json"]);
    const { Images } = JSON.parse(stdout);

    return Images.sort((a, b) => (a.CreationDate < b.CreationDate ? 1 : -1));
  },

  async describeInstances(options = {}) {
    const filters = Object.entries(options).map(([key, value]) => `Name=${key},Values=${value}`);
    const { stdout } = await spawnSafe([
      "aws",
      "ec2",
      "describe-instances",
      "--filters",
      ...filters,
      "--output",
      "json",
    ]);
    const { Reservations } = JSON.parse(stdout);
    const instances = Reservations.flatMap(({ Instances }) => Instances);

    return instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  async runInstances(options = {}, runOptions = {}) {
    const flags = Object.entries(options).map(([key, value]) => `--${key}=${value}`);
    const { stdout } = await spawnSafe(["aws", "ec2", "run-instances", ...flags, "--output", "json"]);
    const { Instances } = JSON.parse(stdout);

    if (runOptions["wait"]) {
      const instanceIds = Instances.map(({ InstanceId }) => InstanceId);
      await spawnSafe(["aws", "ec2", "wait", "instance-running", "--instance-ids", ...instanceIds]);
      return aws.describeInstances({ "instance-id": instanceIds[0] });
    }

    return Instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  async terminateInstances(...instanceIds) {
    await spawnSafe(["aws", "ec2", "terminate-instances", "--instance-ids", ...instanceIds]);
  },
};

const google = {
  async createMachine(platform) {
    const image = await google.getImage(platform);
    const { id: imageId, username } = image;

    const authorizedKeys = await getAuthorizedKeys();
    const sshKeys = authorizedKeys?.map(key => `${username}:${key}`).join("\n") ?? "";

    const { os, type } = platform;
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

async function spawnSsh(options) {
  const { hostname, port, username, command, retries = 10 } = options;
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
    const result = await spawn(ssh, { stdio });
    const { exitCode, stderr } = result;
    if (exitCode === 0) {
      return result;
    }
    cause = stderr.trim() || undefined;
    if (/bad configuration option/i.test(stderr)) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  throw new Error(`SSH failed: ${username}@${hostname}`, { cause });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cloud: { type: "string", default: "docker", choices: ["docker", "aws"] },
      org: { type: "string", default: "oven-sh" },
      os: { type: "string", default: "linux" },
      arch: { type: "string", default: process.arch === "arm64" ? "aarch64" : "x64" },
      distro: { type: "string", default: "debian" },
      release: { type: "string", default: "11" },
      type: { type: "string" },
    },
  });

  const { cloud, os, arch, distro, release, type } = values;
  const platform = { os, arch, distro, release, type };

  let provider;
  if (cloud === "docker") {
    provider = docker;
  } else if (cloud === "aws") {
    provider = aws;
  } else if (cloud === "google") {
    provider = google;
  } else {
    throw new Error(`Unsupported cloud: ${inspect(cloud)}`);
  }

  const machine = await provider.createMachine(platform);
  process.on("SIGINT", () => {
    machine.close().finally(() => process.exit(1));
  });

  if (positionals.length) {
    await machine.exec(positionals);
  } else {
    await machine.attach();
  }
  await machine.close();
}

await main();

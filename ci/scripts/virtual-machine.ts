#!/usr/bin/env bun

import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { exists, readdir, readFile } from "node:fs/promises";
import { inspect, parseArgs } from "node:util";

type Platform = {
  os: "linux" | "windows";
  arch: "aarch64" | "x64";
  distro: string;
  release: string;
};

type Image = {
  id: string;
  name: string;
  username: string;
};

type Machine = {
  exec(command: string[]): Promise<SpawnResult>;
  attach(): Promise<void>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

type Cloud = {
  createMachine(platform: Platform): Promise<Machine>;
  getImage(platform: Platform): Promise<Image>;
};

type AwsImage = {
  ImageId: string;
  Name: string;
  CreationDate: string;
};

type AwsReservation = {
  Instances: AwsInstance[];
};

type AwsInstance = {
  InstanceId: string;
  ImageId: string;
  PublicIpAddress: string;
  LaunchTime: string;
};

type AwsCloud = Cloud & {
  describeImages(options?: Record<string, string>): Promise<AwsImage[]>;
  describeInstances(options?: Record<string, string>): Promise<AwsInstance[]>;
  runInstances(options?: Record<string, string>, runOptions?: { wait?: boolean }): Promise<AwsInstance[]>;
  terminateInstances(...instanceIds: string[]): Promise<void>;
};

type DockerCloud = Cloud & {
  getPlatform(platform: Platform): string;
};

const docker: DockerCloud = {
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

    const exec = async (command: string[]) => {
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

    let url: string | undefined;
    if (os === "linux") {
      if (distro === "debian") {
        url = `docker.io/library/debian:${release}`;
      } else if (distro === "ubuntu") {
        url = `docker.io/library/ubuntu:${release}`;
      } else if (distro === "amazonlinux") {
        url = `public.ecr.aws/amazonlinux/amazonlinux:${release}`;
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

const aws: AwsCloud = {
  async createMachine(platform) {
    const image = await aws.getImage(platform);
    const userData = await getUserData(platform, image);
    const { id, username } = image;
    const { arch } = platform;

    const [instance] = await aws.runInstances(
      {
        ["image-id"]: id,
        ["instance-type"]: arch === "aarch64" ? "t4g.large" : "t3.large",
        ["user-data"]: Buffer.from(userData).toString("base64"),
      },
      {
        wait: true,
      },
    );

    const { InstanceId, PublicIpAddress } = instance;
    const options = { hostname: PublicIpAddress, username };

    const exec = (command?: string[] | undefined) => {
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

    let name: string | undefined;
    let username: string | undefined;
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
      }
    } else if (os === "windows") {
      if (distro === "server") {
        name = `Windows_Server-${release}-English-Full-Base-*`;
        username = "Administrator";
      }
    }

    if (name && username) {
      const images = await aws.describeImages({ state: "available", "owner-alias": "amazon", name });
      if (images.length) {
        const [image] = images;
        const { Name, ImageId } = image;
        return {
          id: ImageId,
          name: Name,
          username,
        };
      }
    }

    throw new Error(`Unsupported image: ${inspect(platform)}`);
  },

  async describeImages(options = {}) {
    const filters = Object.entries(options).map(([key, value]) => `Name=${key},Values=${value}`);
    const { stdout } = await spawnSafe(["aws", "ec2", "describe-images", "--filters", ...filters, "--output", "json"]);
    const { Images }: { Images: AwsImage[] } = JSON.parse(stdout);

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
    const { Reservations }: { Reservations: AwsReservation[] } = JSON.parse(stdout);
    const instances = Reservations.flatMap(({ Instances }) => Instances);

    return instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  async runInstances(options = {}, runOptions = {}) {
    const flags = Object.entries(options).map(([key, value]) => `--${key}=${value}`);
    const { stdout } = await spawnSafe(["aws", "ec2", "run-instances", ...flags, "--output", "json"]);
    const { Instances }: { Instances: AwsInstance[] } = JSON.parse(stdout);

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

type GoogleCloud = Cloud & {
  listImages(options?: Record<string, string>): Promise<GoogleImage[]>;
  createInstances(
    options?: Record<string, string | boolean>,
    createOptions?: { wait?: boolean },
  ): Promise<GoogleInstance[]>;
  listInstances(options?: Record<string, string>): Promise<GoogleInstance[]>;
  deleteInstance(instanceId: string): Promise<void>;
};

type GoogleImage = {
  id: string;
  name: string;
  description: string;
  status: string; // "READY"
  selfLink: string;
  creationTimestamp: string;
};

type GoogleInstance = {
  id: string;
  name: string;
  status: string; // "RUNNING"
  networkInterfaces: {
    networkIP: string;
    stackType: "IPV4_ONLY" | "IPV6_ONLY" | "IPV4_IPV6";
    accessConfigs: {
      natIP: string;
      type: "ONE_TO_ONE_NAT" | "EPHEMERAL";
    }[];
  }[];
  creationTimestamp: string;
};

const google: GoogleCloud = {
  async createMachine(platform) {
    const image = await google.getImage(platform);
    const { id: imageId, username } = image;

    const authorizedKeys = await getAuthorizedKeys();
    const sshKeys = authorizedKeys?.map(key => `${username}:${key}`).join("\n") ?? "";

    const [{ id, networkInterfaces }] = await google.createInstances({
      ["zone"]: "us-central1-a",
      ["image"]: imageId,
      ["machine-type"]: "e2-standard-4",
      ["boot-disk-auto-delete"]: true,
      // ["boot-disk-size"]: "10GB",
      // ["boot-disk-type"]: "pd-standard",
      ["metadata"]: `ssh-keys=${sshKeys}`,
    });

    const publicIp = () => {
      for (const { accessConfigs } of networkInterfaces) {
        for (const { natIP } of accessConfigs) {
          return natIP;
        }
      }
      throw new Error(`Failed to find public IP for instance: ${id}`);
    };

    const exec = (command?: string[] | undefined) => {
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

    let name: string | undefined;
    let username: string | undefined;
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
        username = "Administrator";
      }
    }

    if (name && username) {
      const images = await google.listImages({ name, architecture });
      if (images.length) {
        const [image] = images;
        console.log(image);
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
    const images: GoogleImage[] = JSON.parse(stdout);
    return images.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  async listInstances(options = {}) {
    const filter = Object.entries(options)
      .map(([key, value]) => [value.includes("*") ? `${key}~${value}` : `${key}=${value}`])
      .join(" AND ");
    const filters = filter ? ["--filter", filter] : [];
    const { stdout } = await spawnSafe(["gcloud", "compute", "instances", "list", ...filters, "--format", "json"]);
    const instances: GoogleInstance[] = JSON.parse(stdout);
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
    const instances: GoogleInstance[] = JSON.parse(stdout);
    return instances.sort((a, b) => (a.creationTimestamp < b.creationTimestamp ? 1 : -1));
  },

  async deleteInstance(instanceId) {
    await spawnSafe(["gcloud", "compute", "instances", "delete", instanceId, "--zone", "us-central1-a", "--quiet"]);
  },
};

type SpawnOptions = {
  stdio?: "inherit" | "pipe";
};

type SpawnResult = {
  exitCode: number;
  signalCode?: string;
  stdout: string;
  stderr: string;
  spawnError?: Error;
};

async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  console.log("$", ...command);

  let exitCode: number = 1;
  let signalCode: string | undefined;
  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;

  await new Promise((resolve: () => void) => {
    const [cmd, ...args] = command;
    const subprocess = nodeSpawn(cmd, args, { stdio: "pipe", ...options });

    subprocess.on("error", error => {
      exitCode = 1;
      stderr = inspect(error);
      resolve();
    });

    subprocess.on("exit", (code: number, signal: string | undefined) => {
      exitCode = code;
      signalCode = signal;
      resolve();
    });

    subprocess.stdout?.on("data", chunk => {
      stdout += chunk.toString("utf8");
    });

    subprocess.stderr?.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
  });

  if (exitCode !== 0 || signalCode) {
    const reason = command.join(" ");
    const cause = stderr.trim() || stdout.trim() || undefined;

    if (signalCode) {
      spawnError = new Error(`Command killed with ${signalCode}: ${reason}`, { cause });
    } else {
      spawnError = new Error(`Command exited with ${exitCode}: ${reason}`, { cause });
    }
  }

  return {
    exitCode,
    signalCode,
    stdout,
    stderr,
    spawnError,
  };
}

async function spawnSafe(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
  const result = await spawn(command, options);

  const { spawnError } = result;
  if (spawnError) {
    throw spawnError;
  }

  return result;
}

async function getUserData(platform: Platform, image: Image): Promise<string> {
  const { os, arch, distro, release } = platform;
  const { username } = image;

  if (os === "linux") {
    const authorizedKeys = await getAuthorizedKeys();
    return `
#cloud-config

disable_root: false
ssh_pwauth: false
ssh_authorized_keys: [${authorizedKeys ? authorizedKeys.map(key => `"${key}"`).join(", ") : ""}]
`;
  } else if (os === "windows") {
    const authorizedKeys = await getAuthorizedKeys();
    return `
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
New-ItemProperty -Path "HKLM:\\SOFTWARE\\OpenSSH" -Name DefaultShell -Value $(Get-Command powershell).Source -PropertyType String -Force
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
$authorizedKeysPath = "C:\\ProgramData\\ssh\\administrators_authorized_keys"
Set-Content $authorizedKeysPath -Value @"
${authorizedKeys?.join("\r\n") ?? ""}
"@
icacls.exe $authorizedKeysPath /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
`;
  }

  throw new Error(`Unsupported user data: ${inspect(platform)}`);
}

type SshOptions = {
  hostname: string;
  port?: string;
  username?: string;
  command?: string[];
  retries?: number;
};

async function spawnSsh(options: SshOptions): Promise<SpawnResult> {
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

  let cause: string | undefined;
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
    await new Promise((resolve: () => void) => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  throw new Error(`SSH failed: ${username}@${hostname}`, { cause });
}

async function getAuthorizedKeys(): Promise<string[] | undefined> {
  const homePath = homedir();
  const sshPath = join(homePath, ".ssh");

  if (await exists(sshPath)) {
    const sshFiles = await readdir(sshPath, { withFileTypes: true });
    const sshPaths = sshFiles
      .filter(entry => entry.isFile() && entry.name.endsWith(".pub"))
      .map(({ name }) => join(sshPath, name));

    const sshKeys: string[] = await Promise.all(sshPaths.map(path => readFile(path, "utf8")));
    return sshKeys.map(key => key.trim()).filter(key => key.length);
  }
}

async function getAuthorizedKeysForOrganization(organization: string): Promise<string[] | undefined> {
  const response = await fetch(`https://api.github.com/orgs/${organization}/members`);
  if (!response.ok) {
    return;
  }

  const members = await response.json();
  const responses: Response[] = await Promise.all(
    members.map(({ login }) => fetch(`https://github.com/${login}.keys`)),
  );

  const authorizedKeys: string[][] = await Promise.all(
    responses.flatMap(async response => {
      if (!response.ok) {
        return [];
      }

      const body = await response.text();
      return body
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length);
    }),
  );

  return authorizedKeys.flat();
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
    },
  });

  const { cloud, os, arch, distro, release } = values;
  const platforms: Platform[] = [
    { os: "linux", arch: "aarch64", distro: "debian", release: "12" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
    { os: "linux", arch: "aarch64", distro: "debian", release: "10" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2023" },
    { os: "linux", arch: "aarch64", distro: "amazonlinux", release: "2" },
    { os: "linux", arch: "x64", distro: "debian", release: "12" },
    { os: "linux", arch: "x64", distro: "debian", release: "11" },
    { os: "linux", arch: "x64", distro: "debian", release: "10" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04" },
    { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04" },
    { os: "linux", arch: "x64", distro: "amazonlinux", release: "2023" },
    { os: "linux", arch: "x64", distro: "amazonlinux", release: "2" },
    { os: "windows", arch: "x64", distro: "server", release: "2019" },
  ];

  const platform = platforms.find(
    platform =>
      os === platform.os && arch === platform.arch && distro === platform.distro && release === platform.release,
  );
  if (!platform) {
    throw new Error(`Unsupported platform: ${inspect(values)}`);
  }

  let provider: Cloud;
  if (cloud === "docker") {
    provider = docker;
  } else if (cloud === "aws") {
    provider = aws;
  } else if (cloud === "google") {
    provider = google;
  } else {
    throw new Error(`Unsupported cloud: ${inspect(cloud)}`);
  }

  await using machine = await provider.createMachine(platform);
  process.on("SIGINT", () => {
    machine.close().finally(() => process.exit(1));
  });

  if (positionals.length) {
    await machine.exec(positionals);
  } else {
    await machine.attach();
  }
}

await main();

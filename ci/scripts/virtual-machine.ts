#!/usr/bin/env bun

import { spawn as nodeSpawn } from "node:child_process";
import { inspect, parseArgs } from "node:util";

type Platform = {
  os: "linux";
  arch: "aarch64" | "x64";
  distro: string;
  release: string;
};

type Image = {
  id: string;
  name: string;
  username: string;
};

type Machine = Platform & {
  hostname: string;
  username: string;
  spawn(command: string[]): Promise<SpawnResult>;
  shell(): Promise<unknown>;
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

const aws: AwsCloud = {
  async createMachine(platform) {
    const image = await aws.getImage(platform);
    const userData = await getUserData(platform, image);
    console.log(userData);
    const { id, username } = image;
    const [instance] = await aws.runInstances(
      {
        ["image-id"]: id,
        ["instance-type"]: "t4g.large",
        ["user-data"]: Buffer.from(userData).toString("base64"),
      },
      {
        wait: true,
      },
    );
    const { InstanceId, PublicIpAddress } = instance;
    const options = { hostname: PublicIpAddress, username };
    const spawn = (command?: string[] | undefined) => spawnSsh({ ...options, command });
    const close = () => aws.terminateInstances(InstanceId);
    process.on("SIGINT", () => close().finally(() => process.exit(1)));

    return {
      ...platform,
      ...options,
      spawn: command => spawn(command),
      shell: () => spawn(),
      close,
      [Symbol.asyncDispose]: close,
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
    }

    if (name && username) {
      const images = await aws.describeImages({ state: "available", "owner-alias": "amazon", name });
      if (images.length) {
        const [image] = images;
        const { Name, ImageId } = image;
        console.log(`Found image: ${Name} (id: ${ImageId})`);
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

    console.log(`Found ${Images.length} images matching: ${inspect(options)}`);
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

    console.log(`Found ${instances.length} instances matching: ${inspect(options)}`);
    return instances.sort((a, b) => (a.LaunchTime < b.LaunchTime ? 1 : -1));
  },

  async runInstances(options = {}, runOptions = {}) {
    const flags = Object.entries(options).map(([key, value]) => `--${key}=${value}`);
    const { stdout } = await spawnSafe(["aws", "ec2", "run-instances", ...flags, "--output", "json"]);
    const { Instances }: { Instances: AwsInstance[] } = JSON.parse(stdout);

    console.log(`Started ${Instances.length} instances matching: ${inspect(options)}`);
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

type SpawnOptions = {
  stdio?: "inherit" | "pipe";
};

type SpawnResult = {
  exitCode: number;
  signalCode?: string;
  stdout: string;
  stderr: string;
};

async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  console.log("$", ...command);

  let exitCode: number = 1;
  let signalCode: string | undefined;
  let stdout = "";
  let stderr = "";
  await new Promise(resolve => {
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

  return {
    exitCode,
    signalCode,
    stdout,
    stderr,
  };
}

async function spawnSafe(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
  const result = await spawn(command, options);
  const { exitCode, signalCode, stdout, stderr } = result;

  if (exitCode === 0) {
    return result;
  }

  const reason = command.join(" ");
  const cause = stderr?.trim() || stdout?.trim() || undefined;
  if (signalCode) {
    throw new Error(`Command killed with ${signalCode}: ${reason}`, { cause });
  }

  throw new Error(`Command exited with ${exitCode}: ${reason}`, { cause });
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
    console.warn(`SSH failed, retry ${i + 1} / ${retries}...`, cause);
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }

  throw new Error(`SSH failed: ${username}@${hostname}`, { cause });
}

async function getAuthorizedKeys(): Promise<string[] | undefined> {
  const { exitCode, stdout } = await spawn(["gh", "api", "user", "--jq", ".login"]);
  if (exitCode !== 0) {
    return;
  }

  const login = stdout.trim();
  const response = await fetch(`https://github.com/${login}.keys`);
  if (!response.ok) {
    return;
  }

  const body = await response.text();
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      os: { type: "string", default: "linux" },
      arch: { type: "string", default: process.arch === "arm64" ? "aarch64" : "x64" },
      distro: { type: "string", default: "debian" },
      release: { type: "string", default: "11" },
    },
  });

  const { os, arch, distro, release } = values;
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
  ];

  const platform = platforms.find(
    platform =>
      os === platform.os && arch === platform.arch && distro === platform.distro && release === platform.release,
  );
  if (!platform) {
    throw new Error(`Unsupported platform: ${inspect(values)}`);
  }

  await using machine = await aws.createMachine(platform);
  if (positionals.length) {
    await machine.spawn(positionals);
  } else {
    await machine.shell();
  }
}

await main();

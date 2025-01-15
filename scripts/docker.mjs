import { inspect } from "node:util";
import { $, isCI, spawn, spawnSafe, which } from "./utils.mjs";

export const docker = {
  get name() {
    return "docker";
  },

  /**
   * @typedef {"linux" | "darwin" | "windows"} DockerOs
   * @typedef {"amd64" | "arm64"} DockerArch
   * @typedef {`${DockerOs}/${DockerArch}`} DockerPlatform
   */

  /**
   * @param {Platform} platform
   * @returns {DockerPlatform}
   */
  getPlatform(platform) {
    const { os, arch } = platform;
    if (arch === "aarch64") {
      return `${os}/arm64`;
    } else if (arch === "x64") {
      return `${os}/amd64`;
    }
    throw new Error(`Unsupported platform: ${inspect(platform)}`);
  },

  /**
   * @typedef DockerSpawnOptions
   * @property {DockerPlatform} [platform]
   * @property {boolean} [json]
   */

  /**
   * @param {string[]} args
   * @param {DockerSpawnOptions & import("./utils.mjs").SpawnOptions} [options]
   * @returns {Promise<unknown>}
   */
  async spawn(args, options = {}) {
    const docker = which("docker", { required: true });

    let env = { ...process.env };
    if (isCI) {
      env["BUILDKIT_PROGRESS"] = "plain";
    }

    const { json, platform } = options;
    if (json) {
      args.push("--format=json");
    }
    if (platform) {
      args.push(`--platform=${platform}`);
    }

    const { error, stdout } = await spawnSafe($`${docker} ${args}`, { env, ...options });
    if (error) {
      return;
    }
    if (!json) {
      return stdout;
    }

    try {
      return JSON.parse(stdout);
    } catch {
      return;
    }
  },

  /**
   * @typedef {Object} DockerImage
   * @property {string} Id
   * @property {string[]} RepoTags
   * @property {string[]} RepoDigests
   * @property {string} Created
   * @property {DockerOs} Os
   * @property {DockerArch} Architecture
   * @property {number} Size
   */

  /**
   * @param {string} url
   * @param {DockerPlatform} [platform]
   * @returns {Promise<boolean>}
   */
  async pullImage(url, platform) {
    const done = await this.spawn($`pull ${url}`, {
      platform,
      throwOnError: error => !/No such image|manifest unknown/i.test(inspect(error)),
    });
    return !!done;
  },

  /**
   * @param {string} url
   * @param {DockerPlatform} [platform]
   * @returns {Promise<DockerImage | undefined>}
   */
  async inspectImage(url, platform) {
    /** @type {DockerImage[]} */
    const images = await this.spawn($`image inspect ${url}`, {
      json: true,
      throwOnError: error => !/No such image/i.test(inspect(error)),
    });

    if (!images) {
      const pulled = await this.pullImage(url, platform);
      if (pulled) {
        return this.inspectImage(url, platform);
      }
    }

    const { os, arch } = platform || {};
    return images
      ?.filter(({ Os, Architecture }) => !os || !arch || (Os === os && Architecture === arch))
      ?.find((a, b) => (a.Created < b.Created ? 1 : -1));
  },

  /**
   * @typedef {Object} DockerContainer
   * @property {string} Id
   * @property {string} Name
   * @property {string} Image
   * @property {string} Created
   * @property {DockerContainerState} State
   * @property {DockerContainerNetworkSettings} NetworkSettings
   */

  /**
   * @typedef {Object} DockerContainerState
   * @property {"exited" | "running"} Status
   * @property {number} [Pid]
   * @property {number} ExitCode
   * @property {string} [Error]
   * @property {string} StartedAt
   * @property {string} FinishedAt
   */

  /**
   * @typedef {Object} DockerContainerNetworkSettings
   * @property {string} [IPAddress]
   */

  /**
   * @param {string} containerId
   * @returns {Promise<DockerContainer | undefined>}
   */
  async inspectContainer(containerId) {
    const containers = await this.spawn($`container inspect ${containerId}`, { json: true });
    return containers?.find(a => a.Id === containerId);
  },

  /**
   * @returns {Promise<DockerContainer[]>}
   */
  async listContainers() {
    const containers = await this.spawn($`container ls --all`, { json: true });
    return containers || [];
  },

  /**
   * @typedef {Object} DockerRunOptions
   * @property {string[]} [command]
   * @property {DockerPlatform} [platform]
   * @property {string} [name]
   * @property {boolean} [detach]
   * @property {"always" | "never"} [pull]
   * @property {boolean} [rm]
   * @property {"no" | "on-failure" | "always"} [restart]
   */

  /**
   * @param {string} url
   * @param {DockerRunOptions} [options]
   * @returns {Promise<DockerContainer>}
   */
  async runContainer(url, options = {}) {
    const { detach, command = [], ...containerOptions } = options;
    const args = Object.entries(containerOptions)
      .filter(([_, value]) => typeof value !== "undefined")
      .map(([key, value]) => (typeof value === "boolean" ? `--${key}` : `--${key}=${value}`));
    if (detach) {
      args.push("--detach");
    } else {
      args.push("--tty", "--interactive");
    }

    const stdio = detach ? "pipe" : "inherit";
    const result = await this.spawn($`run ${args} ${url} ${command}`, { stdio });
    if (!detach) {
      return;
    }

    const containerId = result.trim();
    const container = await this.inspectContainer(containerId);
    if (!container) {
      throw new Error(`Failed to run container: ${inspect(result)}`);
    }
    return container;
  },

  /**
   * @param {Platform} platform
   * @returns {Promise<DockerImage>}
   */
  async getBaseImage(platform) {
    const { os, distro, release } = platform;
    const dockerPlatform = this.getPlatform(platform);

    let url;
    if (os === "linux") {
      if (distro === "debian" || distro === "ubuntu" || distro === "alpine") {
        url = `docker.io/library/${distro}:${release}`;
      } else if (distro === "amazonlinux") {
        url = `public.ecr.aws/amazonlinux/amazonlinux:${release}`;
      }
    }

    if (url) {
      const image = await this.inspectImage(url, dockerPlatform);
      if (image) {
        return image;
      }
    }

    throw new Error(`Unsupported platform: ${inspect(platform)}`);
  },

  /**
   * @param {DockerContainer} container
   * @param {MachineOptions} [options]
   * @returns {Machine}
   */
  toMachine(container, options = {}) {
    const { Id: containerId } = container;

    const exec = (command, options) => {
      return spawn(["docker", "exec", containerId, ...command], options);
    };

    const execSafe = (command, options) => {
      return spawnSafe(["docker", "exec", containerId, ...command], options);
    };

    const upload = async (source, destination) => {
      await spawn(["docker", "cp", source, `${containerId}:${destination}`]);
    };

    const attach = async () => {
      const { exitCode, error } = await spawn(["docker", "exec", "-it", containerId, "sh"], {
        stdio: "inherit",
      });

      if (exitCode === 0 || exitCode === 130) {
        return;
      }

      throw error;
    };

    const snapshot = async name => {
      await spawn(["docker", "commit", containerId]);
    };

    const kill = async () => {
      await spawn(["docker", "kill", containerId]);
    };

    return {
      cloud: "docker",
      id: containerId,
      spawn: exec,
      spawnSafe: execSafe,
      upload,
      attach,
      snapshot,
      close: kill,
      [Symbol.asyncDispose]: kill,
    };
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<Machine>}
   */
  async createMachine(options) {
    const { Id: imageId, Os, Architecture } = await docker.getBaseImage(options);

    const container = await docker.runContainer(imageId, {
      platform: `${Os}/${Architecture}`,
      command: ["sleep", "1d"],
      detach: true,
      rm: true,
      restart: "no",
    });

    return this.toMachine(container, options);
  },
};

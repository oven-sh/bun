import { inspect } from "node:util";
import { isPrivileged, spawnSafe, spawnScp, spawnSsh, spawnSshSafe, which } from "./utils.mjs";

/**
 * @link https://tart.run/
 * @link https://github.com/cirruslabs/tart
 */
export const tart = {
  get name() {
    return "tart";
  },

  /**
   * @param {string[]} args
   * @param {import("./utils.mjs").SpawnOptions} options
   * @returns {Promise<unknown>}
   */
  async spawn(args, options) {
    const tart = which("tart", { required: true });
    const { json } = options || {};
    const command = json ? [tart, ...args, "--format=json"] : [tart, ...args];

    const { stdout } = await spawnSafe(command, options);
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
   * @typedef {"tahoe" | "sequoia" | "sonoma" | "ventura" | "monterey"} TartDistro
   * @typedef {`ghcr.io/cirruslabs/macos-${TartDistro}-base`} TartImage
   * @link https://github.com/orgs/cirruslabs/packages?repo_name=macos-image-templates
   */

  /**
   * @param {Platform} platform
   * @returns {TartImage}
   */
  getImage(platform) {
    const { os, arch, release } = platform;
    if (os !== "darwin" || arch !== "aarch64") {
      throw new Error(`Unsupported platform: ${inspect(platform)}`);
    }
    const distros = {
      "26": "tahoe",
      "15": "sequoia",
      "14": "sonoma",
      "13": "ventura",
      "12": "monterey",
    };
    const distro = distros[release];
    if (!distro) {
      throw new Error(`Unsupported macOS release: ${release}`);
    }
    return `ghcr.io/cirruslabs/macos-${distro}-base`;
  },

  /**
   * @typedef {Object} TartVm
   * @property {string} Name
   * @property {"running" | "stopped"} State
   * @property {"local"} Source
   * @property {number} Size
   * @property {number} Disk
   * @property {number} [CPU]
   * @property {number} [Memory]
   */

  /**
   * @returns {Promise<TartVm[]>}
   */
  async listVms() {
    return this.spawn(["list"], { json: true });
  },

  /**
   * @param {string} name
   * @returns {Promise<TartVm | undefined>}
   */
  async getVm(name) {
    const result = await this.spawn(["get", name], {
      json: true,
      throwOnError: error => !/does not exist/i.test(inspect(error)),
    });
    if (!result) {
      return undefined;
    }
    return {
      Name: name,
      ...result,
    };
  },

  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  async stopVm(name) {
    await this.spawn(["stop", name, "--timeout=0"], {
      throwOnError: error => !/does not exist|is not running/i.test(inspect(error)),
    });
  },

  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  async deleteVm(name) {
    await this.stopVm(name);
    await this.spawn(["delete", name], {
      throwOnError: error => !/does not exist/i.test(inspect(error)),
    });
  },

  /**
   * @param {string} name
   * @param {TartImage} image
   * @returns {Promise<void>}
   */
  async cloneVm(name, image) {
    const localName = image.split("/").pop();
    const localVm = await this.getVm(localName);
    if (localVm) {
      const { Name } = localVm;
      await this.spawn(["clone", Name, name]);
      return;
    }

    console.log(`Cloning macOS image: ${image} (this will take a long time)`);
    // stdio: inherit — surface tart's layer-by-layer pull progress so
    // Buildkite's 10-min no-output watchdog doesn't kill a ~25GB download.
    await this.spawn(["clone", image, localName], { stdio: "inherit" });
    await this.spawn(["clone", localName, name], { stdio: "inherit" });
  },

  /**
   * @typedef {Object} TartMount
   * @property {boolean} [readOnly]
   * @property {string} source
   * @property {string} destination
   */

  /**
   * @typedef {Object} TartVmOptions
   * @property {number} [cpuCount]
   * @property {number} [memoryGb]
   * @property {number} [diskSizeGb]
   * @property {boolean} [no-graphics]
   * @property {boolean} [no-audio]
   * @property {boolean} [no-clipboard]
   * @property {boolean} [recovery]
   * @property {boolean} [vnc]
   * @property {boolean} [vnc-experimental]
   * @property {boolean} [net-softnet]
   * @property {TartMount[]} [dir]
   */

  /**
   * @param {string} name
   * @param {TartVmOptions} options
   * @returns {Promise<void>}
   */
  async runVm(name, options = {}) {
    const { cpuCount, memoryGb, diskSizeGb, dir, ...vmOptions } = options;

    const setArgs = ["--random-mac", "--random-serial"];
    if (cpuCount) {
      setArgs.push(`--cpu=${cpuCount}`);
    }
    if (memoryGb) {
      setArgs.push(`--memory=${memoryGb}`);
    }
    if (diskSizeGb) {
      setArgs.push(`--disk-size=${diskSizeGb}`);
    }
    await this.spawn(["set", name, ...setArgs]);

    const args = Object.entries(vmOptions)
      .filter(([, value]) => value !== undefined)
      .flatMap(([key, value]) => (typeof value === "boolean" ? (value ? [`--${key}`] : []) : [`--${key}=${value}`]));
    if (dir?.length) {
      args.push(
        ...dir.map(({ source, destination, readOnly }) => `--dir=${source}:${destination}${readOnly ? ":ro" : ""}`),
      );
    }

    // `tart run` blocks for the VM's lifetime, so it's detached and not
    // awaited. stopVm() makes it exit non-zero; without throwOnError:false
    // that becomes an unhandled rejection and Node exits 1.
    this.spawn(["run", name, ...args], { detached: true, throwOnError: false });
  },

  /**
   * @param {string} name
   * @returns {Promise<string | undefined>}
   */
  async getVmIp(name) {
    const stdout = await this.spawn(["ip", name], {
      retryOnError: error => /no IP address found/i.test(inspect(error)),
      throwOnError: error => !/does not exist/i.test(inspect(error)),
    });
    return stdout?.trim();
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<Machine>}
   */
  async createMachine(options) {
    const { name, imageName, cpuCount, memoryGb, diskSizeGb, rdp } = options;
    // cirruslabs base images use password auth (admin/admin); spawnSsh shells
    // out to sshpass for that, which isn't on stock macOS. Check before
    // cloneVm/runVm so a missing dep doesn't orphan a running VM.
    if (!which("sshpass")) {
      throw new Error("tart machine ops need sshpass: brew install hudochenkov/sshpass/sshpass");
    }

    const image = imageName || this.getImage(options);
    const machineId = name || `i-${Math.random().toString(36).slice(2, 11)}`;
    await this.cloneVm(machineId, image);

    await this.runVm(machineId, {
      cpuCount,
      memoryGb,
      diskSizeGb,
      "net-softnet": isPrivileged(),
      "no-audio": true,
      "no-clipboard": true,
      "no-graphics": true,
      "vnc-experimental": rdp,
    });

    return {
      ...this.toMachine(machineId),
      imageId: image,
      instanceType: cpuCount || memoryGb ? `${cpuCount ?? "?"}cpu-${memoryGb ?? "?"}gb` : "default",
      region: "local",
    };
  },

  /**
   * @param {string} name
   * @returns {Machine}
   */
  toMachine(name) {
    const connect = async () => {
      const hostname = await this.getVmIp(name);
      return {
        hostname,
        // hardcoded by base images
        username: "admin",
        password: "admin",
      };
    };

    const exec = async (command, options) => {
      const connectOptions = await connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const execSafe = async (command, options) => {
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

    const snapshot = async label => {
      if (!label) throw new Error("tart snapshot() requires a label");
      // tart can't push a running VM — stop first, then push to ghcr. Auth via
      // TART_REGISTRY_USERNAME / TART_REGISTRY_PASSWORD (set by the image-build
      // pipeline; tart reads them directly, no `tart login` needed).
      await this.stopVm(name);
      const remote = `ghcr.io/oven-sh/${label}`;
      console.log(`Pushing ${name} to ${remote} (~25GB, this takes a while)...`);
      await this.spawn(["push", name, remote], { stdio: "inherit" });
      return remote;
    };

    const close = async () => {
      await this.deleteVm(name);
    };

    return {
      cloud: "tart",
      id: name,
      spawn: exec,
      spawnSafe: execSafe,
      attach,
      upload,
      snapshot,
      close,
      [Symbol.asyncDispose]: close,
    };
  },
};

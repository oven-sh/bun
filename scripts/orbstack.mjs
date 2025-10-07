import { inspect } from "node:util";
import { getUserData } from "./machine.mjs";
import { $, getUsernameForDistro, mkdtemp, rm, setupUserData, spawnSafe, spawnSshSafe, writeFile } from "./utils.mjs";

/**
 * @link https://docs.orbstack.dev/
 */
export const orbstack = {
  get name() {
    return "orbstack";
  },

  /**
   * @typedef {Object} OrbstackImage
   * @property {string} distro
   * @property {string} version
   * @property {string} arch
   */

  /**
   * @param {Platform} platform
   * @returns {OrbstackImage}
   */
  getImage(platform) {
    const { os, arch, distro, release } = platform;
    if (os !== "linux" || !/^debian|ubuntu|alpine|fedora|centos$/.test(distro)) {
      throw new Error(`Unsupported platform: ${inspect(platform)}`);
    }

    return {
      distro,
      version: release,
      arch: arch === "aarch64" ? "arm64" : "amd64",
    };
  },

  /**
   * @typedef {Object} OrbstackVm
   * @property {string} id
   * @property {string} name
   * @property {"running"} state
   * @property {OrbstackImage} image
   * @property {OrbstackConfig} config
   */

  /**
   * @typedef {Object} OrbstackConfig
   * @property {string} default_username
   * @property {boolean} isolated
   */

  /**
   * @typedef {Object} OrbstackVmOptions
   * @property {string} [name]
   * @property {OrbstackImage} image
   * @property {string} [username]
   * @property {string} [password]
   * @property {string} [userData]
   */

  /**
   * @param {OrbstackVmOptions} options
   * @returns {Promise<OrbstackVm>}
   */
  async createVm(options) {
    const { name, image, username, password, userData } = options;
    const { distro, version, arch } = image;
    const uniqueId = name || `linux-${distro}-${version}-${arch}-${Math.random().toString(36).slice(2, 11)}`;

    const args = [`--arch=${arch}`, `${distro}:${version}`, uniqueId];
    if (username) {
      args.push(`--user=${username}`);
    }
    if (password) {
      args.push(`--set-password=${password}`);
    }

    let userDataPath;
    if (userData) {
      userDataPath = mkdtemp("orbstack-user-data-", "user-data.txt");
      console.log("User data path:", userData);
      writeFile(userDataPath, userData);
      args.push(`--user-data=${userDataPath}`);
    }

    try {
      await spawnSafe($`orbctl create ${args}`);
    } finally {
      if (userDataPath) {
        rm(userDataPath);
      }
    }

    return this.inspectVm(uniqueId);
  },

  /**
   * @param {string} name
   */
  async deleteVm(name) {
    await spawnSafe($`orbctl delete ${name}`, {
      throwOnError: error => !/machine not found/i.test(inspect(error)),
    });
  },

  /**
   * @param {string} name
   * @returns {Promise<OrbstackVm | undefined>}
   */
  async inspectVm(name) {
    const { exitCode, stdout } = await spawnSafe($`orbctl info ${name} --format=json`, {
      throwOnError: error => !/machine not found/i.test(inspect(error)),
    });
    if (exitCode === 0) {
      return JSON.parse(stdout);
    }
  },

  /**
   * @returns {Promise<OrbstackVm[]>}
   */
  async listVms() {
    const { stdout } = await spawnSafe($`orbctl list --format=json`);
    return JSON.parse(stdout);
  },

  /**
   * @param {MachineOptions} options
   * @returns {Promise<Machine>}
   */
  async createMachine(options) {
    const { distro } = options;
    const username = getUsernameForDistro(distro);
    const userData = getUserData({ ...options, username });

    const image = this.getImage(options);
    const vm = await this.createVm({
      image,
      username,
      userData,
    });

    const machine = this.toMachine(vm, options);

    await setupUserData(machine, options);

    return machine;
  },

  /**
   * @param {OrbstackVm} vm
   * @returns {Machine}
   */
  toMachine(vm) {
    const { id, name, config } = vm;

    const { default_username: username } = config;
    const connectOptions = {
      username,
      hostname: `${name}@orb`,
    };

    const exec = async (command, options) => {
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const execSafe = async (command, options) => {
      return spawnSshSafe({ ...connectOptions, command }, options);
    };

    const attach = async () => {
      await spawnSshSafe({ ...connectOptions });
    };

    const upload = async (source, destination) => {
      await spawnSafe(["orbctl", "push", `--machine=${name}`, source, destination]);
    };

    const close = async () => {
      await this.deleteVm(name);
    };

    return {
      cloud: "orbstack",
      id,
      name,
      spawn: exec,
      spawnSafe: execSafe,
      upload,
      attach,
      close,
      [Symbol.asyncDispose]: close,
    };
  },
};

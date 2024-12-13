import { $, spawnSafe, which, getUsernameForDistro } from "./utils.mjs";

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

    let env = { ...process.env };
    // if (isCI) {
    //   env; // TODO: Add Google Cloud credentials
    // } else {
    //   env["TERM"] = "dumb";
    // }

    const { stdout } = await spawnSafe($`${gcloud} ${args} --format json`, {
      env,
      ...options,
    });
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
   * @property {GoogleDisk[]} disks
   * @property {GoogleNetworkInterface[]} networkInterfaces
   * @property {object} [scheduling]
   * @property {"STANDARD" | "SPOT"} [scheduling.provisioningModel]
   * @property {boolean} [scheduling.preemptible]
   * @property {Record<string, string | undefined>} [labels]
   * @property {string} selfLink
   * @property {string} creationTimestamp
   */

  /**
   * @typedef {Object} GoogleDisk
   * @property {string} deviceName
   * @property {boolean} boot
   * @property {"X86_64" | "ARM64"} architecture
   * @property {string[]} [licenses]
   * @property {number} diskSizeGb
   */

  /**
   * @typedef {Object} GoogleNetworkInterface
   * @property {"IPV4_ONLY" | "IPV4_IPV6" | "IPV6_ONLY"} stackType
   * @property {string} name
   * @property {string} network
   * @property {string} networkIP
   * @property {string} subnetwork
   * @property {GoogleAccessConfig[]} accessConfigs
   */

  /**
   * @typedef {Object} GoogleAccessConfig
   * @property {string} name
   * @property {"ONE_TO_ONE_NAT" | "INTERNAL_NAT"} type
   * @property {string} [natIP]
   */

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
   * @param {string} instanceId
   * @param {string} username
   * @param {string} zoneId
   * @param {object} [options]
   * @param {boolean} [options.wait]
   * @returns {Promise<string | undefined>}
   * @link https://cloud.google.com/sdk/gcloud/reference/compute/reset-windows-password
   */
  async resetWindowsPassword(instanceId, username, zoneId, options = {}) {
    const attempts = options.wait ? 15 : 1;
    for (let i = 0; i < attempts; i++) {
      const result = await this.spawn(
        $`compute reset-windows-password ${instanceId} --user=${username} --zone=${zoneId}`,
        {
          throwOnError: error => !/instance may not be ready for use/i.test(inspect(error)),
        },
      );
      if (result) {
        const { password } = result;
        if (password) {
          return password;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 60000 * i));
    }
  },

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
   * @param {MachineOptions} options
   * @returns {Promise<GoogleImage>}
   */
  async getMachineImage(options) {
    const { os, arch, distro, release } = options;
    const architecture = arch === "aarch64" ? "ARM64" : "X86_64";

    /** @type {string | undefined} */
    let family;
    if (os === "linux") {
      if (!distro || distro === "debian") {
        family = `debian-${release || "*"}`;
      } else if (distro === "ubuntu") {
        family = `ubuntu-${release?.replace(/\./g, "") || "*"}`;
      } else if (distro === "fedora") {
        family = `fedora-coreos-${release || "*"}`;
      } else if (distro === "rhel") {
        family = `rhel-${release || "*"}`;
      }
    } else if (os === "windows" && arch === "x64") {
      if (!distro || distro === "server") {
        family = `windows-${release || "*"}`;
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
    const { name, os, arch, distro, instanceType, tags, preemptible, detached } = options;
    const image = await google.getMachineImage(options);
    const { selfLink: imageUrl } = image;

    const username = getUsername(distro || os);
    const userData = getUserData({ ...options, username });

    /** @type {Record<string, string>} */
    let metadata;
    if (os === "windows") {
      metadata = {
        "enable-windows-ssh": "TRUE",
        "sysprep-specialize-script-ps1": userData,
      };
    } else {
      metadata = {
        "user-data": userData,
      };
    }

    const instance = await google.createInstance({
      "name": name,
      "zone": "us-central1-a",
      "image": imageUrl,
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

    return this.toMachine(instance, options);
  },

  /**
   * @param {GoogleInstance} instance
   * @param {MachineOptions} [options]
   * @returns {Machine}
   */
  toMachine(instance, options = {}) {
    const { id: instanceId, name, zone: zoneUrl, machineType: machineTypeUrl, labels } = instance;
    const machineType = machineTypeUrl.split("/").pop();
    const zoneId = zoneUrl.split("/").pop();

    let os, arch, distro, release;
    const { disks = [] } = instance;
    for (const { boot, architecture, licenses = [] } of disks) {
      if (!boot) {
        continue;
      }

      if (architecture === "X86_64") {
        arch = "x64";
      } else if (architecture === "ARM64") {
        arch = "aarch64";
      }

      for (const license of licenses) {
        const linuxMatch = /(debian|ubuntu|fedora|rhel)-(\d+)/i.exec(license);
        if (linuxMatch) {
          os = "linux";
          [, distro, release] = linuxMatch;
        } else {
          const windowsMatch = /windows-server-(\d+)-dc-core/i.exec(license);
          if (windowsMatch) {
            os = "windows";
            distro = "windowsserver";
            [, release] = windowsMatch;
          }
        }
      }
    }

    let publicIp;
    const { networkInterfaces = [] } = instance;
    for (const { accessConfigs = [] } of networkInterfaces) {
      for (const { type, natIP } of accessConfigs) {
        if (type === "ONE_TO_ONE_NAT" && natIP) {
          publicIp = natIP;
        }
      }
    }

    let preemptible;
    const { scheduling } = instance;
    if (scheduling) {
      const { provisioningModel, preemptible: isPreemptible } = scheduling;
      preemptible = provisioningModel === "SPOT" || isPreemptible;
    }

    /**
     * @returns {SshOptions}
     */
    const connect = () => {
      if (!publicIp) {
        throw new Error(`Failed to find public IP for instance: ${name}`);
      }

      /** @type {string | undefined} */
      let username;

      const { os, distro } = options;
      if (os || distro) {
        username = getUsernameForDistro(distro || os);
      }

      return { hostname: publicIp, username };
    };

    const spawn = async (command, options) => {
      const connectOptions = connect();
      return spawnSsh({ ...connectOptions, command }, options);
    };

    const spawnSafe = async (command, options) => {
      const connectOptions = connect();
      return spawnSshSafe({ ...connectOptions, command }, options);
    };

    const rdp = async () => {
      const { hostname, username } = connect();
      const rdpUsername = `${username}-rdp`;
      const password = await google.resetWindowsPassword(instanceId, rdpUsername, zoneId, { wait: true });
      return { hostname, username: rdpUsername, password };
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

    const terminate = async () => {
      await google.deleteInstance(instanceId, zoneId);
    };

    return {
      cloud: "google",
      os,
      arch,
      distro,
      release,
      id: instanceId,
      imageId: undefined,
      name,
      instanceType: machineType,
      region: zoneId,
      publicIp,
      preemptible,
      labels,
      spawn,
      spawnSafe,
      rdp,
      attach,
      upload,
      snapshot,
      close: terminate,
      [Symbol.asyncDispose]: terminate,
    };
  },

  /**
   * @param {Record<string, string>} [labels]
   * @returns {Promise<Machine[]>}
   */
  async getMachines(labels) {
    const filters = labels ? this.getFilters({ labels }) : {};
    const instances = await google.listInstances(filters);
    return instances.map(instance => this.toMachine(instance));
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

// Hardcoded module "node:os"

var tmpdir = function () {
  var env = Bun.env;

  tmpdir = function () {
    if (process.platform === "win32") {
      // using node implementation
      // https://github.com/nodejs/node/blob/ad5e2dab4c8306183685973387829c2f69e793da/lib/os.js#L186
      var path = env["TEMP"] || env["TMP"] || (env["SystemRoot"] || env["windir"]) + "\\temp";
      if (path.length > 1 && path[path.length - 1] === "\\" && !String.prototype.endsWith.$call(path, ":\\")) {
        path = String.prototype.slice.$call(path, 0, -1);
      }
      return path;
    }
    var path = env["TMPDIR"] || env["TMP"] || env["TEMP"] || "/tmp";
    const length = path.length;
    if (length > 1 && path[length - 1] === "/") path = path.slice(0, -1);
    return path;
  };

  return tmpdir();
};

// os.cpus() is super expensive
// Specifically: getting the CPU speed on Linux is very expensive
// Some packages like FastGlob only bother to read the length of the array
// so instead of actually populating the entire object
// we turn them into getters
function lazyCpus({ cpus }) {
  return () => {
    const array = new Array(navigator.hardwareConcurrency);
    function populate() {
      const results = cpus();
      const length = results.length;
      array.length = length;
      for (let i = 0; i < length; i++) {
        array[i] = results[i];
      }
    }

    for (let i = 0; i < array.length; i++) {
      // This is technically still observable via
      // Object.getOwnPropertyDescriptors(), but it should be okay.
      const instance = {
        get model() {
          if (array[i] === instance) populate();
          return array[i].model;
        },
        set model(value) {
          if (array[i] === instance) populate();
          array[i].model = value;
        },

        get speed() {
          if (array[i] === instance) populate();
          return array[i].speed;
        },

        set speed(value) {
          if (array[i] === instance) populate();
          array[i].speed = value;
        },

        get times() {
          if (array[i] === instance) populate();
          return array[i].times;
        },
        set times(value) {
          if (array[i] === instance) populate();
          array[i].times = value;
        },

        toJSON() {
          if (array[i] === instance) populate();
          return array[i];
        },
      };

      array[i] = instance;
    }

    return array;
  };
}

// all logic based on `process.platform` and `process.arch` is inlined at bundle time
function bound(obj) {
  return {
    availableParallelism: () => navigator.hardwareConcurrency,
    arch: () => process.arch,
    cpus: lazyCpus(obj),
    endianness: () => (process.arch === "arm64" || process.arch === "x64" ? "LE" : $bundleError("TODO: endianness")),
    freemem: obj.freemem.bind(obj),
    getPriority: obj.getPriority.bind(obj),
    homedir: obj.homedir.bind(obj),
    hostname: obj.hostname.bind(obj),
    loadavg: obj.loadavg.bind(obj),
    networkInterfaces: obj.networkInterfaces.bind(obj),
    platform: () => process.platform,
    release: obj.release.bind(obj),
    setPriority: obj.setPriority.bind(obj),
    get tmpdir() {
      return tmpdir;
    },
    totalmem: obj.totalmem.bind(obj),
    type: () =>
      process.platform === "win32"
        ? "Windows_NT"
        : process.platform === "darwin"
          ? "Darwin"
          : process.platform === "linux"
            ? "Linux"
            : $bundleError("TODO: type"),
    uptime: obj.uptime.bind(obj),
    userInfo: obj.userInfo.bind(obj),
    version: obj.version.bind(obj),
    machine: obj.machine.bind(obj),
    devNull: process.platform === "win32" ? "\\\\.\\nul" : "/dev/null",
    EOL: process.platform === "win32" ? "\r\n" : "\n",
    constants: $processBindingConstants.os,
  };
}

const out = bound($zig("node_os.zig", "OS.create"));

symbolToStringify(out, "arch");
symbolToStringify(out, "availableParallelism");
symbolToStringify(out, "endianness");
symbolToStringify(out, "freemem");
symbolToStringify(out, "homedir");
symbolToStringify(out, "hostname");
symbolToStringify(out, "platform");
symbolToStringify(out, "release");
symbolToStringify(out, "tmpdir");
symbolToStringify(out, "totalmem");
symbolToStringify(out, "type");
symbolToStringify(out, "uptime");
symbolToStringify(out, "version");
symbolToStringify(out, "machine");
function symbolToStringify(obj, key) {
  obj[key][Symbol.toPrimitive] = function (hint) {
    return obj[key]();
  };
}

export default out;

// Hardcoded module "node:os"

export var tmpdir = function () {
  var { Bun } = $lazy("primordials");
  var env = Bun.env;

  tmpdir = function () {
    var path = env["TMPDIR"] || env["TMP"] || env["TEMP"] || "/tmp";
    const length = path.length;
    if (length > 1 && path[length - 1] === "/") path = path.slice(0, -1);
    return path;
  };

  return tmpdir();
};

function bound(obj) {
  return {
    arch: obj.arch.bind(obj),
    cpus: obj.cpus.bind(obj),
    endianness: obj.endianness.bind(obj),
    freemem: obj.freemem.bind(obj),
    getPriority: obj.getPriority.bind(obj),
    homedir: obj.homedir.bind(obj),
    hostname: obj.hostname.bind(obj),
    loadavg: obj.loadavg.bind(obj),
    networkInterfaces: obj.networkInterfaces.bind(obj),
    platform: obj.platform.bind(obj),
    release: obj.release.bind(obj),
    setPriority: obj.setPriority.bind(obj),
    get tmpdir() {
      return tmpdir;
    },
    totalmem: obj.totalmem.bind(obj),
    type: obj.type.bind(obj),
    uptime: obj.uptime.bind(obj),
    userInfo: obj.userInfo.bind(obj),
    version: obj.version.bind(obj),
    machine: obj.machine.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
    constants: obj.constants,
    [Symbol.for("CommonJS")]: 0,
  };
}

var os = bound(Bun._Os());

export var {
  arch,
  cpus,
  endianness,
  freemem,
  getPriority,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  platform,
  release,
  setPriority,
  totalmem,
  type,
  uptime,
  userInfo,
  version,
  machine,
  devNull,
  EOL,
  constants,
} = os;

export default os;

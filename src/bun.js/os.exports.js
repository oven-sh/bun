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
    tmpdir: obj.tmpdir.bind(obj),
    totalmem: obj.totalmem.bind(obj),
    type: obj.type.bind(obj),
    uptime: obj.uptime.bind(obj),
    userInfo: obj.userInfo.bind(obj),
    version: obj.version.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
    constants: obj.constants,
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
  tmpdir,
  totalmem,
  type,
  uptime,
  userInfo,
  version,
  devNull,
  EOL,
  constants,
} = os;

export default os;

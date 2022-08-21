function bound(obj) {
  return {
    arch: obj.arch.bind(obj),
    endianness: obj.endianness.bind(obj),
    freemem: obj.freemem.bind(obj),
    homedir: obj.homedir.bind(obj),
    hostname: obj.hostname.bind(obj),
    uptime: obj.uptime.bind(obj),
    platform: obj.platform.bind(obj),
    release: obj.release.bind(obj),
    tmpdir: obj.tmpdir.bind(obj),
    totalmem: obj.totalmem.bind(obj),
    type: obj.type.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
  };
}

var os = bound(Bun._Os());

export var {
  arch,
  endianness,
  freemem,
  homedir,
  hostname,
  uptime,
  platform,
  release,
  tmpdir,
  totalmem,
  type,
  devNull,
  EOL,
} = os;

export default os;

function bound(obj) {
  return {
    arch: obj.arch.bind(obj),
    homedir: obj.homedir.bind(obj),
    platform: obj.platform.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
  };
}

var os = bound(Bun._Os());

export var {
  arch,
  homedir,
  platform,
  devNull,
  EOL,
} = os;

export default os;

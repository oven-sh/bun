function bound(obj) {
  return {
    arch: obj.arch.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
  };
}

var os = bound(Bun._Os());

export var {
  arch,
  devNull,
  EOL,
} = os;

export default os;

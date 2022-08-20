function bound(obj) {
  return {
    arch: obj.arch.bind(obj),
    __arch: obj.__arch,
    devNull: obj.devNull,
  };
}

var os = bound(Bun._Os());

export var {
  arch,
  __arch,
  devNull,
} = os;

export default os;

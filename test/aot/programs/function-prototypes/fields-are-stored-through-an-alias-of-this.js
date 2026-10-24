// A plain function stores the fields of what it constructs through another name for `this`, under fixed names and under names it is handed.
function Meter(size, name, value) {
  const self = this;
  self.size = size;
  self[name] = value;
  Object.assign(self, { extra: size });
}
Meter.prototype.read = function () { return typeof this.size + ":" + typeof this.extra + ":" + Object.keys(this).join("+"); };
console.log(new Meter(1, "a", 1).read(), new Meter("s", "size", null).read(), new Meter(undefined, "extra", 2n).read());

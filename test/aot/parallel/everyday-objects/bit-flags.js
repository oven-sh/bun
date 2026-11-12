// Flags as bits in a field, set, cleared, listed by name
const flags = { read: 1, write: 2, run: 4, all: 7 };
class Access {
  bits = 0;
  allow(...names) {
    for (const name of names) this.bits |= flags[name];
    return this;
  }
  deny(name) {
    this.bits &= ~flags[name];
    return this;
  }
  get names() {
    return Object.keys(flags).filter(name => (this.bits & flags[name]) === flags[name]);
  }
}
function list(first, second) {
  const access = new Access().allow(first, second);
  const before = access.names.join("+");
  access.deny(first).bits ^= flags.run;
  return before + " " + access.names.join("+") + " " + access.bits.toString(2).padStart(3, "0");
}
console.log(list("read", "write"));
console.log(list("all", "run"));
console.log(list("run", "run"));

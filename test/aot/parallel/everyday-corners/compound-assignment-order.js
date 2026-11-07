// Compound assignment order: compiled answers as plain.
const log = [];
const o = {
  get v() {
    log.push("get");
    return 1;
  },
  set v(x) {
    log.push("set" + x);
  },
};
const k = () => (log.push("key"), "v"),
  r = () => (log.push("rhs"), 2);
o[k()] += r();
console.log(log.join());

// Logical assignment short circuits: compiled answers as plain.
const log = [];
const o = {
  get a() {
    log.push("get a");
    return 1;
  },
  set a(v) {
    log.push("set a");
  },
  get b() {
    log.push("get b");
    return null;
  },
  set b(v) {
    log.push("set b");
  },
};
o.a ||= 2;
o.a &&= 3;
o.a ??= 4;
o.b ??= 5;
o.b ||= 6;
o.b &&= 7;
console.log(log.join());

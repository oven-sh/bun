// Only own enumerable properties of the source are copied; getters run once each, in order; a frozen source copies as writable data.
const proto = { kind: "p" };
const log = [];
function describe(object) {
  return Object.entries(Object.getOwnPropertyDescriptors(object)).map(([key, d]) => key + ":" + d.value + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-")).join(" ");
}
for (let round = 0; round < 4; round++) {
  const hidden = { alpha: 1, beta: 2, gamma: 3 };
  Object.defineProperty(hidden, "beta", { enumerable: false });
  log.push(describe(Object.assign(Object.create(proto), hidden)));
  log.push(describe(Object.assign(Object.create(proto), Object.freeze({ alpha: 1, beta: 2 }))));
  log.push(describe(Object.assign(Object.create(proto), Object.seal({ alpha: 1, beta: 2 }))));
  const getters = { alpha: 1, get beta() { log.push("getter beta"); return 2; }, gamma: 3, get delta() { log.push("getter delta"); return 4; } };
  log.push(describe(Object.assign(Object.create(proto), getters)));
  const inherited = Object.create({ above: 1 });
  inherited.own = 2;
  log.push(describe(Object.assign(Object.create(proto), inherited)));
  const changing = { alpha: 1, get beta() { delete this.gamma; this.delta = 4; return 2; }, gamma: 3 };
  log.push(describe(Object.assign(Object.create(proto), changing)));
}
console.log(log.join("\n"));

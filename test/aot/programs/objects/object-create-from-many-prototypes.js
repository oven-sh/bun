const makers = [];
for (let n = 0; n < 40; n++) {
  const proto = { ["tag" + n]: n, which() { return n; } };
  makers.push(value => {
    const self = Object.create(proto);
    self.value = value;
    return self;
  });
}
const collect = globalThis.gc ?? (() => globalThis.Bun.gc(true));
let sum = 0;
const kept = [];
for (let round = 0; round < 2000; round++) {
  const made = makers[round % 40](round);
  if (Object.getPrototypeOf(made).which() !== round % 40) throw new Error("wrong prototype");
  if (made["tag" + (round % 40)] !== round % 40) throw new Error("wrong inherited value");
  sum += made.value + made.which();
  if (round % 97 === 0) kept.push(made);
  if (round % 500 === 0) collect();
}
console.log(sum, kept.length, kept.map(made => made.which()).join());
console.log(Object.keys(Object.create({ a: 1 })).length, Object.create(null) instanceof Object);

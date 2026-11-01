// A Proxy reaches the same for-in as objects with a custom prototype or copied properties. The loop only calls the Proxy's traps, so the Proxy doesn't escape and the program is compiled once.
// STATISTIC: EngineRuns = 1
function keysOf(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys.join(" ");
}
const created = Object.create({ inherited: 1 });
created.own = 2;
const reparented = Object.setPrototypeOf({ own: 3 }, { inherited: 4 });
const literal = { own: 5, __proto__: { inherited: 6 } };
const assigned = Object.assign({ own: 7 }, { copied: 8 });
const proxy = new Proxy({}, {
  ownKeys: () => ["fromTrap"],
  getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }),
});
console.log(keysOf(created), "|", keysOf(reparented), "|", keysOf(literal), "|", keysOf(assigned), "|", keysOf(proxy));

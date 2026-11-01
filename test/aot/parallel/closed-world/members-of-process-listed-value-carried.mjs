// `process` comes back from code that the compiler does not follow: out of a trap of a Proxy, out of a reviver, out of an object behind a Proxy, out of an event. Whoever holds it lists its members, and the ones that Bun makes at the first read are what they are when the program names them.
const roads = {
  trap: () => new Proxy({}, { get: () => process }).anything,
  reviver: () => JSON.parse("1", () => process),
  member: () => new Proxy({ held: process }, {}).held,
  event: () => new CustomEvent("x", { detail: process }).detail,
  applied: () => new Proxy(function () {}, { apply: () => process })(),
};
const late = /^(std|final|allowedNode)/;
for (const [name, take] of Object.entries(roads)) {
  const handed = take();
  const entries = Object.entries(handed).filter(([key]) => late.test(key));
  console.log(name, entries.map(([key, value]) => key + " " + typeof value).join());
  const read = [];
  for (const key in handed) if (late.test(key)) read.push(typeof handed[key]);
  console.log(name, read.join(), typeof { ...handed }.stdout.write);
}

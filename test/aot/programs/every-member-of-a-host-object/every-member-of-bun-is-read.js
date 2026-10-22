// Every way to go over the members of Bun reads each of them, and no read throws: what plain Bun answers is answered.

const kindOf = read => {
  try {
    return typeof read();
  } catch (error) {
    return "throws " + error.message;
  }
};
const digest = pairs => {
  const counts = {};
  const thrown = [];
  for (const [key, kind] of pairs) {
    if (kind.startsWith("throws")) thrown.push(String(key) + ": " + kind);
    else counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return JSON.stringify(counts) + " " + JSON.stringify(thrown);
};

console.log("keys", digest(Object.keys(Bun).map(key => [key, kindOf(() => Bun[key])])));
console.log("values", kindOf(() => Object.values(Bun).length));
console.log("entries", kindOf(() => Object.entries(Bun).length));
console.log("spread", kindOf(() => ({ ...Bun })));
console.log("assign", kindOf(() => Object.assign({}, Bun)));
const inLoop = [];
for (const key in Bun) inLoop.push([key, kindOf(() => Bun[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(Bun).map(key => [key, kindOf(() => Reflect.get(Bun, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(Bun)));
console.log("JSON", kindOf(() => JSON.stringify(Bun)));

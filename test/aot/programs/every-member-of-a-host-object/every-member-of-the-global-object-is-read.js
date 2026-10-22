// Every way to go over the members of the global object reads each of them, and no read throws: what plain Bun answers is answered.

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

console.log("keys", digest(Object.keys(globalThis).map(key => [key, kindOf(() => globalThis[key])])));
console.log("values", kindOf(() => Object.values(globalThis).length));
console.log("entries", kindOf(() => Object.entries(globalThis).length));
console.log("spread", kindOf(() => ({ ...globalThis })));
console.log("assign", kindOf(() => Object.assign({}, globalThis)));
const inLoop = [];
for (const key in globalThis) inLoop.push([key, kindOf(() => globalThis[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(globalThis).map(key => [key, kindOf(() => Reflect.get(globalThis, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(globalThis)));
console.log("JSON", kindOf(() => JSON.stringify(globalThis)));

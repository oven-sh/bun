// Every way to go over the members of console reads each of them, and no read throws: what plain Bun answers is answered.

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

console.log("keys", digest(Object.keys(console).map(key => [key, kindOf(() => console[key])])));
console.log("values", kindOf(() => Object.values(console).length));
console.log("entries", kindOf(() => Object.entries(console).length));
console.log("spread", kindOf(() => ({ ...console })));
console.log("assign", kindOf(() => Object.assign({}, console)));
const inLoop = [];
for (const key in console) inLoop.push([key, kindOf(() => console[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(console).map(key => [key, kindOf(() => Reflect.get(console, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(console)));
console.log("JSON", kindOf(() => JSON.stringify(console)));

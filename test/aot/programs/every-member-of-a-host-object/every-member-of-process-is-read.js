// Every way to go over the members of process reads each of them, and no read throws: what plain Bun answers is answered.

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

console.log("keys", digest(Object.keys(process).map(key => [key, kindOf(() => process[key])])));
console.log("values", kindOf(() => Object.values(process).length));
console.log("entries", kindOf(() => Object.entries(process).length));
console.log("spread", kindOf(() => ({ ...process })));
console.log("assign", kindOf(() => Object.assign({}, process)));
const inLoop = [];
for (const key in process) inLoop.push([key, kindOf(() => process[key])]);
console.log("for-in", digest(inLoop));
console.log("own keys", digest(Reflect.ownKeys(process).map(key => [key, kindOf(() => Reflect.get(process, key))])));
console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(process)));
console.log("JSON", kindOf(() => JSON.stringify(process)));

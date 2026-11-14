// A Proxy lists what its handler says, and answers what its handler says.
function read(source) {
  const found = [];
  for (const key in source) found.push(`${key}:${typeof source[key]}`);
  return found.join(" ");
}
const proxy = new Proxy({}, {
  ownKeys: () => ["constructor", "made"],
  getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }),
  get: (target, key) => (key === "constructor" ? Object : "up"),
});
console.log(read([JSON.parse("{}"), proxy][1]));

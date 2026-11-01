// Error thrown from a getter in a spread: compiled answers as plain.
const bad = {
  a: 1,
  get b() {
    throw new Error("getter");
  },
  c: 3,
};
const log = [];
try {
  ({ ...bad });
} catch (e) {
  log.push(e.message);
}
try {
  JSON.stringify(bad);
} catch (e) {
  log.push(e.message);
}
try {
  Object.assign({}, bad);
} catch (e) {
  log.push(e.message);
}
try {
  Object.values(bad);
} catch (e) {
  log.push(e.message);
}
try {
  structuredClone(bad);
} catch (e) {
  log.push(e.message);
}
console.log(log.join());

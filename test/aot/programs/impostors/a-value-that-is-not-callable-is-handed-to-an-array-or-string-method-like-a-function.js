function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

async function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

const takers = [
  ["map", f => [1, 2].map(f)],
  ["map of an empty array", f => [].map(f)],
  ["forEach", f => [1, 2].forEach(f)],
  ["filter", f => [1, 2].filter(f)],
  ["find", f => [1, 2].find(f)],
  ["some of an empty array", f => [].some(f)],
  ["reduce", f => [1, 2].reduce(f)],
  ["reduce of one", f => [1].reduce(f)],
  ["sort", f => [2, 1, 10].sort(f)],
  ["sort of one", f => [1].sort(f)],
  ["toSorted", f => [2, 1, 10].toSorted(f)],
  ["flatMap", f => [1].flatMap(f)],
  ["Array.from", f => Array.from([1, 2], f)],
  ["a typed array's map", f => new Uint8Array([1]).map(f)],
  ["a typed array's sort", f => new Uint8Array([2, 1]).sort(f)],
  ["a map's forEach", f => new Map([[1, 2]]).forEach(f)],
  ["a set's forEach", f => new Set().forEach(f)],
  ["replace", f => "abc".replace("b", f)],
  ["replace without a match", f => "abc".replace("x", f)],
  ["replaceAll with a regular expression", f => "abcb".replaceAll(/b/g, f)],
  ["JSON.parse", f => JSON.parse("[1,2]", f)],
  ["JSON.stringify", f => JSON.stringify({ a: 1, b: 2 }, f)],
];

const values = [
  ["a function", () => value => value],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 5],
  ["a string", () => "$&$&"],
  ["an object", () => ({ handleEvent() { log.push("handled"); }, toString: () => "an object" })],
  ["an array of names", () => ["b"]],
  ["a class", () => class {}],
];

process.on("uncaughtException", error => log.push("uncaught " + error.constructor.name));

async function main() {
  for (const [taker, run] of takers) {
    for (const [name, make] of values) await attempt(taker + " gets " + name, () => run(make()));
  }
}

main();

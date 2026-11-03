// process.argv and process.execArgv hold arrays that the program may replace, delete, redefine and freeze. What native code takes from them follows.
const { parseArgs } = require("node:util");
const out = [];
function describe(name) {
  const descriptor = Object.getOwnPropertyDescriptor(process, name);
  if (!descriptor) return name + " none";
  return [name, Array.isArray(descriptor.value), typeof descriptor.get, descriptor.writable, descriptor.enumerable, descriptor.configurable].join();
}
function read(name) { return process[name]; }
function argv() { return process.argv; }
function flagGiven() { return process.argv.includes("--flag"); }
for (const name of ["argv", "execArgv"]) {
  out.push(describe(name), read(name) === read(name), Object.keys(process).includes(name), name in process, Object.hasOwn(process, name));
  const first = read(name);
  first.push("--pushed");
  out.push(read(name).at(-1));
  first.pop();
}
out.push(argv().length >= 1, typeof argv()[0], flagGiven(), Bun.argv === process.argv);
for (let round = 0; round < 3; round++) {
  process.argv = ["one", "two", "--flag", "--round=" + round];
  out.push(argv().join(), flagGiven(), describe("argv"), JSON.stringify(parseArgs({ options: { flag: { type: "boolean" }, round: { type: "string" } } }).values));
  process.argv = "no array";
  out.push(argv(), describe("argv"));
  try { out.push(flagGiven()); } catch (error) { out.push(error.constructor.name); }
  out.push(delete process.argv, argv(), "argv" in process, describe("argv"));
  let reads = 0;
  Object.defineProperty(process, "argv", { get() { reads++; return ["three", "four", "--flag"]; }, configurable: true, enumerable: false });
  out.push(argv().join(), flagGiven(), reads, describe("argv"), Object.keys(process).includes("argv"), JSON.stringify(parseArgs({ options: { flag: { type: "boolean" } } }).values));
  Object.defineProperty(process, "argv", { value: Object.freeze(["five", "six"]), writable: false, configurable: true, enumerable: true });
  process.argv = ["ignored"];
  out.push(argv().join(), flagGiven(), describe("argv"));
  Object.defineProperty(process, "argv", { value: ["seven"], writable: true, configurable: true, enumerable: true });
}
process.execArgv = ["--changed"];
out.push(process.execArgv.join(), describe("execArgv"), delete process.execArgv, process.execArgv);
console.log(out.join(" | "));

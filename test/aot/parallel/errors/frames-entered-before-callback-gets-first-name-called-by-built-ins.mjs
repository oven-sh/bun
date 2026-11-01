// Callbacks that left sight are called by built-in functions. The stacks are taken before the callbacks get their first names.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];

function make(result) {
  return handedBack(function callback(value) {
    kept.push(new Error(String(value)));
    return result;
  });
}
const all = [];
const use = (label, run) => {
  const callback = make(label === "sort" ? 0 : label === "replace" ? "x" : true);
  const before = kept.length;
  run(callback);
  all.push({ label, callback, error: kept[before] });
};
use("map", f => [1].map(f));
use("filter", f => [1].filter(f));
use("sort", f => [2, 1].sort(f));
use("replace", f => "a".replace(/a/, f));
use("replace by text", f => "a".replace("a", f));
use("from", f => Array.from([1], f));
use("parse", f => JSON.parse("1", f));
use("stringify", f => JSON.stringify({ a: 1 }, f));
use("map forEach", f => new Map([[1, 2]]).forEach(f));
use("set forEach", f => new Set([1]).forEach(f));
use("typed array", f => new Uint8Array(1).forEach(f));
use("call", f => f.call(null, 1));
use("apply", f => f.apply(null, [1]));
use("reflect", f => Reflect.apply(f, null, [1]));
use("spread", f => f(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
use("bound", f => f.bind(null, 1)());
use("reduce", f => [1, 2].reduce(f));
use("find", f => [1].find(f));
use("getter", f => Object.defineProperty({}, "x", { get: f }).x);
use("setter", f => { Object.defineProperty({}, "x", { set: f }).x = 1; });
use("proxy", f => new Proxy({}, { get: f }).x);
use("to primitive", f => { try { `${{ [Symbol.toPrimitive]: f }}`; } catch {} });
use("tag", f => f`a`);
for (const { label, callback } of all)
  give(callback, "for " + label);
for (const { label, error } of all)
  console.log(label, "|", names(error, 2));

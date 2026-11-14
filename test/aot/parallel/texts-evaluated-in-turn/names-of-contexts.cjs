// Functions of a context read and store names while the host changes the sandbox and what is above it.
const vm = require("vm");
const lines = [];
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
class Box {
  constructor() { this.field = "box"; }
  get computed() { return "computed"; }
}
const sandboxes = [
  () => ({ a: 1, field: "compiled", gone: "here" }),
  () => Object.create(null),
  () => Object.create({ a: "above", field: "field above" }),
  () => new Box(),
  () => JSON.parse('{"a":1,"gone":{"q":1}}'),
  () => Object.assign({}, { a: 1, field: undefined }),
];
for (const make of sandboxes) {
  const sandbox = make(), realm = vm.createContext(sandbox), run = t => vm.runInContext(hidden(t), realm);
  const show = v => (v === sandbox ? "sandbox" : typeof v === "function" ? "function" : v && typeof v === "object" ? Object.prototype.toString.call(v) : String(v));
  const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name + ": " + e.message); } };
  const reads = run(`[() => a, () => field, () => gone, () => computed, () => Math, () => parseInt, () => missing, () => undefined, () => globalThis === self, () => typeof late]`);
  const stores = run(`[v => { a = v; return a; }, v => { field = v; return field; }, v => { gone = v; return gone; }, v => { Math = v; return Math; }, v => { "use strict"; gone = v; return gone; }, v => { for (let k = 0; k < 3; k++) count = k + v; return count; }]`);
  const readAll = () => { for (let k = 0; k < 2; k++) for (const read of reads) attempt(read); };
  readAll();
  sandbox.late = 1; sandbox.self = sandbox; readAll();
  delete sandbox.gone; delete sandbox.field; readAll();
  sandbox.Math = "mine"; readAll();
  delete sandbox.Math; readAll();
  for (let k = 0; k < 2; k++) for (const store of stores) { attempt(() => store(k)); lines.push(Object.keys(sandbox).join()); }
  readAll();
  for (const n of ["a", "field", "gone", "Math", "count"]) attempt(() => sandbox[n]);
  Object.defineProperty(sandbox, "a", { get() { lines.push("got"); return 5; }, set(v) { lines.push("set " + v); }, configurable: true, enumerable: true });
  readAll();
  attempt(() => stores[0](8)); attempt(() => stores[0](9));
  Object.defineProperty(sandbox, "field", { value: "fixed", writable: false, configurable: true });
  attempt(() => stores[1](8)); attempt(() => stores[1](9)); readAll();
  Object.setPrototypeOf(sandbox, { missing: "from above" }); readAll();
  Object.freeze(sandbox);
  for (const store of stores) attempt(() => store(12));
  readAll();
}
console.log(lines.join("\n"));

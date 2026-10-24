// Members of process, one probe of many. It prints what plain Bun prints.
function read(o) { return o.c; }
const show = v => (typeof v === "function" ? "function" : String(v));
function churn(p, n) { for (let i = 0; i < n; i++) { Reflect.set(p, "passing" + i, i); if (i) Reflect.deleteProperty(p, "passing" + (i - 1)); } }
function scenario(name, make, steps) {
  const p = make(); p.tag = 1;
  const heir = Object.create(p); heir.own = 1;
  const out = [];
  for (const step of steps) { step(p); for (let i = 0; i < 4; i++) out.push(show(read(heir))); }
  console.log(name, out.filter((v, i) => i % 4 === 3).join(" "));
}
const accessor = p => Object.defineProperty(p, "c", { get() { return "got"; }, set(v) {}, configurable: true, enumerable: true });
const data = v => p => Object.defineProperty(p, "c", { value: v, writable: true, configurable: true, enumerable: true });
const other = (k, v) => p => { p[k] = v; };
const drop = k => p => { delete p[k]; };
for (const [kind, make] of [["literal", () => ({})], ["parsed", () => JSON.parse('{"z0":0,"z1":1,"z2":2}')]]) {
  scenario(kind + " accessor, churn", make, [accessor, p => churn(p, 100)]);
  scenario(kind + " accessor, churn twice", make, [accessor, p => churn(p, 100), p => churn(p, 100)]);
  scenario(kind + " data before, accessor, churn, drop, churn", make, [other("first", 296), accessor, p => churn(p, 100), drop("first"), p => churn(p, 100), other("late", 297)]);
  scenario(kind + " accessor, churn, data", make, [accessor, p => churn(p, 100), data(5)]);
  scenario(kind + " accessor, churn, drop c, other", make, [accessor, p => churn(p, 100), drop("c"), other("late", 298)]);
  scenario(kind + " accessor, churn, churn, drop c, other", make, [accessor, p => churn(p, 100), p => churn(p, 60), drop("c"), other("late", 298), other("later", 299)]);
  scenario(kind + " accessor, churn, churn, data, other", make, [accessor, p => churn(p, 100), p => churn(p, 60), data(6), other("late", 298)]);
}

// Members of process, one probe of many. It prints what plain Bun prints.
const NAMES = ["key", "next", "method", "other"];
const read = [o => o.key, o => o.next, o => o.method, o => o.other];
const has = [o => "key" in o, o => "next" in o, o => "method" in o, o => "other" in o];
const setMethod = (o, v) => { o.method = v; };
const show = v => (typeof v === "function" ? "function" : String(v));
function churn(p, n) { for (let i = 0; i < n; i++) { Reflect.set(p, "passing" + i, i); if (i) Reflect.deleteProperty(p, "passing" + (i - 1)); } }
function look(heirs) { const out = []; for (const o of heirs) for (let k = 0; k < NAMES.length; k++) out.push(show(read[k](o)) + (has[k](o) ? "+" : "-")); return out.join(" "); }
function scenario(label, make, rounds) {
  const p = make(); p.tag = 1;
  const heirs = []; for (let i = 0; i < 3; i++) { const o = Object.create(p); for (let j = 0; j < i; j++) o["own" + j] = j; heirs.push(o); }
  console.log(label, "start", look(heirs));
  churn(p, 40);
  Object.defineProperty(p, "next", { value: 296, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(p, "key", { get() { return "got"; }, set(v) {}, configurable: true, enumerable: true });
  for (let i = 0; i < rounds; i++) console.log(label, "defined", look(heirs));
  churn(p, 61);
  setMethod(p, 297);
  for (let i = 0; i < rounds; i++) console.log(label, "stored", look(heirs));
}
for (const rounds of [1, 2, 3]) {
  scenario("literal " + rounds, () => ({}), rounds);
  scenario("parsed " + rounds, () => JSON.parse('{"z0":0,"z1":1,"z2":2}'), rounds);
}

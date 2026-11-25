// Loops ask whether the properties of records are truthy: strings, numbers, booleans, objects, null and nothing.
// STATISTIC: SiteTruthsToldInline >= 4
const turns = JSON.parse("40");
let calls = 0;
const values = ['""', '"a"', "0", "1", "-1", "0.5", "-0", "true", "false", "null", "[]", "{}", '"\\u00e9"', "12345678901", "1e300"];
const record = i => JSON.parse(`{"name":"p${i}","a":${values[i % values.length]},"b":${values[(i * 7 + 3) % values.length]},"n":${i % 7}}`);
const list = Array.from({ length: 90 }, (_, i) => record(i));
for (let i = 0; i < list.length; i += 11) delete list[i].a;
function both(l) { let a = 0; for (const o of l) if (o.a && o.b) a += o.n; return a; }
function either(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; if (o.a || o.b) a += o.n; } return a; }
function none(l) { let a = 0; for (const o of l) if (!o.a) a += o.n; return a; }
function named(l) { let a = 0; for (const o of l) a += o.name ? o.n : 100; return a; }
let s = 0;
for (let t = 0; t < turns; t++) s += both(list) + either(list) * 3 + none(list) * 5 + named(list) * 7;
console.log(s);
const more = [NaN, 0n, 5n, -0n, undefined, Symbol("s"), () => 1, new String(""), new Boolean(false), "a".repeat(40).slice(40), ["", ""].join(""), String(list[0].name).slice(0, 0), `${""}`, "x" + list[1].name, Infinity];
const odd = more.map((value, i) => { const o = record(i); o.a = value; o.b = more[(i * 4 + 1) % more.length]; return o; });
odd.push(new Proxy(record(3), { get(t, k) { calls++; return t[k]; } }), Object.defineProperty(record(4), "a", { get() { calls += 10; return ""; } }), Object.create(record(5)), record(6));
for (let t = 0; t < turns; t++) {
  const line = odd.map(o => [both, either, none, named].map(f => f([o, record(2)])).join(":")).join(" ");
  if (t % 13 === 0) console.log(line, calls);
}

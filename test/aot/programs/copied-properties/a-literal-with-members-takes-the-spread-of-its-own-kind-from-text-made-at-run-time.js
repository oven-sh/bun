function withDefaults(o) { return { n: 1, b: true, d: 0.5, ...o }; }
function sum(o) { return o.n + (o.b ? 1 : 0) + o.d; }
const hide = new Function("x", ["return", "x"].join(process.argv.length > 99 ? "" : " "));
const stranger = new Function("o", "v", ["o.n = v", "o.b = v", "o.d = v"].join(process.argv.length > 99 ? "" : ";"));
let total = 0;
const out = [];
for (let i = 0; i < 200; i++) {
  const first = withDefaults({});
  first.n = i; first.d = i / 2;
  if (i % 50 === 49) stranger(first, i % 100 === 99 ? undefined : null);
  const second = withDefaults(hide(first));
  const third = withDefaults(hide(second));
  if (i % 50 === 49) out.push(String(second.n), String(second.b), String(second.d), String(sum(third)), JSON.stringify(third));
  else total += sum(third);
}
console.log(total, out.join(" "));

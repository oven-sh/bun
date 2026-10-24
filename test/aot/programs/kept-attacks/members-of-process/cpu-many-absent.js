// Members of process: cpu many absent. It prints what plain Bun prints.
function read(o) { return o.missing; }
function has(o) { return "missing" in o; }
class Base { method() { return 1; } get got() { return 2; } }
function call(o) { return o.method(); }
function got(o) { return o.got; }
const rounds = Number(process.argv[2] ?? 1);
const mode = process.argv[3] ?? "absent";
const source = [];
for (let i = 0; i < 2000; i++) source.push(`{"k${i}": ${i}, "a": ${i}}`);
const parsed = JSON.parse("[" + source.join(",") + "]");
const assigned = parsed.map((p, i) => Object.assign({ first: i }, p));
const spread = parsed.map((p, i) => ({ first: i, ...p }));
function a(o) { return o.a; }
let sum = 0;
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < 2000; i++) {
    if (mode === "parsed") sum += a(parsed[i]);
    else if (mode === "assigned") sum += a(assigned[i]);
    else if (mode === "spread") sum += a(spread[i]);
    else if (mode === "parsed-absent") sum += read(parsed[i]) === undefined ? 1 : 0;
    else if (mode === "spread-absent") sum += read(spread[i]) === undefined ? 1 : 0;
  }
}
console.log(rounds, mode, sum);

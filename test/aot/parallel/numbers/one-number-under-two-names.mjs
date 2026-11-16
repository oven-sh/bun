// Operators whose operands are one number under two names, parameters and variables: each is asked once.
class Pair { constructor(x, y) { this.x = x; this.y = y; } }
let outer = 3;
const lines = [];
function sums(p, a, b, c) { const d = a; let e = d; outer = a; return p.x * a + p.y * d + (p.x - e) * outer + (a - d) * p.y + b * c; }
function steps(p, a) { const twice = a; p.x = p.x * a - twice; p.y = p.y * twice - a; outer = twice; p.x = p.x - outer * a; return p.x + p.y + outer; }
function makes(a, b) { const made = new Pair(a, -b); return made.x * a + made.y * b + (made.x - a) * (made.y - b); }
const values = [1, -0, 0.5, 2147483647, NaN, "3", "x", undefined, null, true, 2n, { valueOf() { return 4; } }, Symbol("s")];
const show = value => (Object.is(value, -0) ? "-0" : typeof value + String(value));
for (const x of values) for (const a of values) {
  for (const run of [() => sums(new Pair(x, 2), a, a, x), () => steps(new Pair(x, 1.5), a), () => makes(a, x)]) {
    let answer;
    for (let k = 0; k < 3; k++) { try { answer = show(run()); } catch (e) { answer = e.name; } }
    lines.push(answer);
  }
}
console.log(lines.join("\n"), show(outer));

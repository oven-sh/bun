class A { constructor() { this.kind = "a"; } }
class B { constructor() { this.kind = "b"; } }
class C { constructor() { this.kind = "c"; } }
function byBreak(x, n) { const c = x instanceof A; let t = 0; for (let i = 0; i < n; i++) { if (!(x instanceof B)) break; t += c ? 1 : 2; } return t; }
function byReturn(x, n) { const c = x instanceof C; let t = 0; for (let i = 0; i < n; i++) { if (!(x instanceof B)) return t + 1000; t += c ? 1 : 2; } return t; }
function byThrow(x, n) { const c = x instanceof A; let t = 0; for (let i = 0; i < n; i++) { if (!(x instanceof C)) throw new RangeError("out"); t += (c || "no").length | 0; } return t; }
function byContinue(x, n) { const c = x instanceof B; let t = 0; for (let i = 0; i < n; i++) { if (!(x instanceof A)) continue; t += (c && 5) | 0; t += 1; } return t; }
function byLabel(x, n) { const c = x instanceof A; let t = 0; outer: for (let k = 0; k < 2; k++) { for (let i = 0; i < n; i++) { if (!(x instanceof B)) break outer; t += c ? 1 : 2; } t += 100; } return t; }
function byLabelOnward(x, n) { const c = x instanceof C; let t = 0; outer: for (let k = 0; k < 2; k++) { for (let i = 0; i < n; i++) { if (x instanceof A) continue outer; t += c ? "yes".length : 1; } t += 100; } return t; }
function denied(x, n) { const c = !(x instanceof A); let t = 0; for (let i = 0; i < 300; i++) { if (x instanceof A) break; t += c ? 1 : 2; } return t + n; }
function byHead(n) { const c = n > 0, d = n === 0, e = n >= 2; let t = 0; for (let i = 0; i < n; i++) t += (c ? 1 : 2) + (d ? 10 : 20) + (e ? 100 : 200); return t; }
globalThis.kept = [byBreak, byReturn, byThrow, byContinue, byLabel, byLabelOnward, denied];
const four = JSON.parse("4"), zero = JSON.parse("0");
for (const run of globalThis.kept) {
  const said = [];
  for (const make of [() => new A(), () => new B(), () => new C(), () => null, () => 7]) for (const n of [four, zero, 1]) { try { said.push(run(make(), n)); } catch (e) { said.push(e.constructor.name); } }
  console.log(run.name, said.join());
}
console.log("byHead", [0, 1, 2, 3, -1, 2.5, NaN].map(byHead).join());

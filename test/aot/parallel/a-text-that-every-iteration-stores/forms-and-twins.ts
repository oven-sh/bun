// A text that a loop grows and that every iteration stores: pushed, put into a field, a variable, a list, a closure's variable.
// The twins keep their builder: a store in some iterations, a store behind an inner loop that grows the text, a text whose characters the loop reads.
const PARTS = ["usr", "local", "Ā", "", "\u{1f600}", "bin"];
let last = "", count = 0;
class Holder { text = ""; list: string[] = []; put(s: string): void { this.text = s; } }
function pushed(parts: string[]): string { let s = ""; const o: string[] = []; for (const p of parts) { s += "/" + p; o.push(s); } return o.join(" ") + "|" + s; }
function pushedBoth(parts: string[]): string { let s = "^"; const o: string[] = []; for (const p of parts) { s += p; o.push(s, p); } return o.join(" "); }
function field(parts: string[]): string { let s = ""; const h = new Holder(); for (const p of parts) { s += p; h.text = s; } return h.text + (h.text === s); }
function variable(n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += i; last = s; } return last + (last === s) + s.length; }
function element(n: number): string { let s = ""; const o: string[] = []; for (let i = 0; i < n; i++) { s += "a" + i; o[i] = s; } return o.join() + o.length; }
function closure(n: number): string { let kept = ""; const read = () => kept; let s = ""; let o = ""; for (let i = 0; i < n; i++) { s += "b"; kept = s; o += read().length; } return o + read(); }
function before(n: number): string { let s = "x"; const o: string[] = []; for (let i = 0; i < n; i++) { o.push(s); s += i; } return o.join() + s; }
function several(n: number): string { let s = ""; const o: string[] = []; for (let i = 0; i < n; i++) { s += "a"; s += i; s += "c"; o.push(s); } return o.join(); }
function many(n: number): string { let s = ""; const o: string[] = []; for (let i = 0; i < n; i++) { s += "a"; s += "b"; s += "c"; s += "d"; s += "e"; s += i; o.push(s); } return o.join(); }
function sometimes(n: number): string { let s = ""; const o: string[] = []; for (let i = 0; i < n; i++) { s += "a"; if (i % 3 === 2) o.push(s); } return o.join() + s; }
function behindInner(rows: string[]): string { let s = ""; const o: string[] = []; for (const r of rows) { for (const c of r) s += c + "."; o.push(s); } return o.join("|"); }
function insideInner(rows: string[]): string { let s = ""; const o: string[] = []; for (const r of rows) { s += "<"; for (const c of r) { s += c; o.push(s); } s += ">"; } return o.join("|") + s; }
function begunAnew(rows: string[]): string { const o: string[] = []; let s = ""; for (const r of rows) { s += r; o.push(s); if (s.length > 4) s = ""; } return o.join("|") + s; }
function underHandler(parts: string[]): string { let s = ""; const o: string[] = []; for (const p of parts) { try { s += p; o.push(s); if (p === "") throw p; s += "!"; } catch { o.push("c" + s); } } return o.join("|") + s; }
function readToo(parts: string[]): string { let s = "", n = 0; const o: string[] = []; for (const p of parts) { s += p + "/"; o.push(s); n += s.charCodeAt(s.length - 1); if (s[0] === "u") n++; } return o.join("|") + n; }
function lengthToo(parts: string[]): string { let s = "", n = 0; const o: string[] = []; for (const p of parts) { if (s) s += ","; s += p; n += s.length; o.push(s); } return o.join("|") + n; }
function broken(parts: string[]): string { let s = ""; const o: string[] = []; for (const p of parts) { s += p; o.push(s); if (o.length === 3) break; } return o.join("|") + s; }
function* yielded(parts: string[]): Generator<string> { let s = ""; const o: string[] = []; for (const p of parts) { s += p; o.push(s); yield o.join(); } }
async function awaited(parts: string[]): Promise<string> { let s = ""; const o: string[] = []; for (const p of parts) { s += p; o.push(s); await null; } return o.join("|"); }
const own = { push(s: string): number { count += s.length; return count; } };
function ownPush(parts: string[]): string { let s = ""; for (const p of parts) { s += p; own.push(s); } return s + count; }
for (let k = 0; k < 3; k++) {
  console.log(pushed(PARTS), pushedBoth(PARTS), field(PARTS), variable(12), element(7));
  console.log(closure(5), before(5), several(4), many(3), sometimes(10), behindInner(PARTS), insideInner(PARTS));
  console.log(begunAnew(PARTS), underHandler(PARTS), readToo(PARTS), lengthToo(PARTS), broken(PARTS), [...yielded(PARTS)].join(";"), ownPush(PARTS));
}
console.log(pushed([]), variable(0), variable(3000).length, pushed(new Array(2000).fill("ab")).length);
awaited(PARTS).then(s => console.log(s));

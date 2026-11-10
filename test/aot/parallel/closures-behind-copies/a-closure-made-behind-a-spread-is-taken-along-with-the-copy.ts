// `{ ...base, at() { return i; } }`, `{ ...props, onClick: () => n }` in a loop: the closure that is made between the copy and the definition that takes it ends the row no longer: one object is made with all its fields.
// What runs between a copy and a definition still runs where it is written: a getter of the source in front of a call behind it.
const log: string[] = [];
type Base = { a: number; b: number };
function withMethod(base: Base, i: number) { return { ...base, at() { return i; } }; }
function withArrow(base: Base, i: number) { return { ...base, on: () => i * 2, c: i }; }
function twoClosures(base: Base, i: number) { return { ...base, f: () => i, g() { return this.a + i; } }; }
function overwritten(base: Base & { at?: () => number }, i: number) { return { at: () => -1, ...base, b: i }; }
function overwrites(base: Base, i: number) { return { ...base, a: () => i }; }
function callBehind(base: Base, i: number) { return { ...base, x: note("call " + i), f: () => i }; }
function note(text: string) { log.push(text); return text.length; }
const plain: Base = { a: 1, b: 2 };
const other: Base = { b: 4, a: 3 };
const grown: any = { a: 5, b: 6 }; grown.extra = 7;
const watched: any = { get a() { log.push("get a"); return 8; }, b: 9 };
const withAt: any = { a: 10, b: 11, at: () => 12 };
const lines: string[] = [];
for (let i = 0; i < 20; i++) {
  const base: any = [plain, other, grown, watched, withAt][i % 5];
  const m = withMethod(base, i), w = withArrow(base, i), t = twoClosures(base, i), o = overwritten(base, i), v = overwrites(base, i), c = callBehind(base, i);
  lines.push([Object.keys(m).join(), m.at(), m.a, Object.keys(w).join(), w.on(), w.c, t.f(), t.g(), Object.keys(o).join(), o.at(), o.b, typeof v.a, (v.a as any)(), Object.keys(c).join(), c.x, c.f()].join(" "));
}
console.log(lines.join("\n"));
console.log(log.join("|"));

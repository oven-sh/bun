// What Function.prototype.call and apply refuse, a receiver that is no function or a list that is none, is said in the words of the expression that wrote the call:
// in the fast version of a function and in the one that runs where its guard turns away, whether that one is written straight (no built-in in its body) or walked (`Math.abs`).
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
function applies(tag: Tag, callee: any, list: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = callee.apply(null, list); return [result, work]; }
function appliesLast(tag: Tag, callee: any, list: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; return callee.apply(null, list); }
function appliesWalked(tag: Tag, callee: any, list: any): any { let work = Math.abs(0); for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = callee.apply(null, list); return [result, work]; }
function appliesRest(this: any, tag: Tag, f: any, ...more: any[]): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = f.apply(this, more); return [result, work]; }
function calls(tag: Tag, f: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = f.call(null, work); return [result]; }
function callsSpread(tag: Tag, f: any, list: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = f.call(null, ...list); return [result, work]; }
function ofMember(tag: Tag, holder: any, list: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; const result = holder.inner.f.apply(holder, list); return [result, work]; }
const real = new Tag(), liar = unseen({ n: 1, m: 2 });
const sum = unseen((a: number, b: number) => a + b), inherits = unseen(Object.create(Function.prototype));
function tell(run: () => any): string { try { return "no error: " + String(run()); } catch (error: any) { return error.name + ": " + error.message; } }
const rows: [string, (tag: any) => any][] = [
  ["a list", tag => applies(tag, sum, unseen([1, 2]))], ["a number for the list", tag => applies(tag, sum, unseen(5))], ["a text for the list", tag => applies(tag, sum, unseen("ab"))],
  ["a number for the list of the last call", tag => appliesLast(tag, sum, unseen(5))], ["a number for the list, walked", tag => appliesWalked(tag, sum, unseen(5))],
  ["apply of what only inherits it", tag => applies(tag, inherits, unseen([1]))], ["apply of what only inherits it, walked", tag => appliesWalked(tag, inherits, unseen([1]))],
  ["apply of what only inherits it, the rest", tag => appliesRest(tag, inherits, 1)], ["call of what only inherits it", tag => calls(tag, inherits)],
  ["call of what only inherits it, spread", tag => callsSpread(tag, inherits, unseen([1, 2]))], ["apply of a member two deep", tag => ofMember(tag, unseen({ inner: { f: inherits } }), unseen([1]))],
];
for (const [name, run] of rows) {
  for (let turn = 0; turn < 50; turn++) tell(() => run(real));
  console.log(name, "|", tell(() => run(real)), "|", tell(() => run(liar)));
}

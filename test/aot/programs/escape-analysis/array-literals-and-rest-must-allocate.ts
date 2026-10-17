// Array literals and rest parameters that must still be real arrays, allocated at the right time.
declare const console: any;
const log: any[] = [];
const show: any = function (this: any, ...a: any[]) { return a.length + ":" + a.join(","); };
const table: any[] = [show];
function changedBefore(f: any) { const a = [1, 2]; a.push(3); return f.apply(null, a); }
function changedByIndex(f: any) { const a = [1, 2]; a[0] = 9; return f.apply(null, a) + " " + a.length + " " + a[0]; }
function usedAfter(f: any) { const a = [1, 2]; const r = f.apply(null, a); return r + " " + a.length + " " + a[1]; }
function changedByCallee() { const a = [1, 2]; const keepIt = (x: any[]) => { x.push(3); }; keepIt(a); return a.length; }
function identity() { const a: any[] = [1]; const b = a; return a === b; }
function returned() { return [1, 2]; }
function nested() { const inner = [1]; const outer = [inner, inner]; return outer[0] === outer[1] && outer.length === 2 && outer[0][0] === 1; }
function inLoop(f: any) { let s = ""; for (let i = 0; i < 3; i++) { const a = [i, i + 1]; s += f.apply(null, a) + ";"; } return s; }
function madeOutsideLoop(f: any) { const a = [1]; let s = ""; for (let i = 0; i < 3; i++) { s += f.apply(null, a) + ";"; } return s; }
function keptInLoop() { const kept: any[] = []; for (let i = 0; i < 3; i++) { const a = [i]; kept.push(a); } return kept[0] !== kept[1] && kept[2][0] === 2; }
function eitherArm(c: boolean, f: any) { const a = [1, 2]; if (c) return f.apply(null, a); return a; }
function outOfRange() { const a = [1, 2]; return String(a[2]) + String((a as any)[-1]) + String((a as any)[1.5]) + String((a as any)["length"]) + String((a as any)["0"]); }
function lengthStored() { const a = [1, 2, 3]; a.length = 1; return a.length + " " + String(a[1]); }
function rest(...v: any[]) { return v; }
function restChanged(...v: any[]) { v[0] = 9; v.push(1); return v.length + ":" + v.join(","); }
function restLength(...v: any[]) { return v.length; }
function restBoth(...v: any[]) { const n = v.length; log.push(v); return n; }
function spreadTwice(f: any, ...v: any[]) { return f(...v) + " " + f(...v); }
function ownApply() { const f: any = function () { return "body"; }; f.apply = (t: any, list: any) => { list.push("seen"); return list; }; const r = f.apply(null, [1, 2]); return Array.isArray(r) + " " + r.join(","); }
for (const f of table) {
  log.push(changedBefore(f), changedByIndex(f), usedAfter(f), changedByCallee(), identity(), returned().length, nested(), inLoop(f), madeOutsideLoop(f), keptInLoop());
  log.push(eitherArm(true, f), eitherArm(false, f).length, outOfRange(), lengthStored(), rest(1, 2).length, Array.isArray(rest()), restChanged(1, 2), restLength(), restLength(1, 2, 3));
  log.push(restBoth(1, 2), spreadTwice(f, 1, 2), ownApply());
}
console.log(log.map(String).join("\n"));
export {};

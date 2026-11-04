// An object stands below another (object create twice), where a method stands under `slot`: delete (typed).
class V { from: any; gone: any; constructor(i: number) { this.from = "here" + i; this.gone = i; } }
class Plain { own = 1; }
let kept: any[] = [];
function makeAbove(): any { return { slot(this: any, x: any) { this.called = true; if (x && typeof x === "object") { x.from = 42; delete x.gone; } return this; } }; }
function below(above: any): any { return Object.create(Object.create(above)); }
function lengthOf(p: V) { return typeof p.from === "string" ? p.from.length : -1; }
function showValue(p: V) { return typeof p.from + " " + p.from + " " + lengthOf(p) + " " + ("gone" in p) + " " + p.gone + " " + Object.keys(p).join(); }
function showResult(r: any) { return r === undefined ? "undefined" : typeof r === "object" || typeof r === "function" ? typeof r : typeof r + ":" + (String(r).length > 30 ? "long" : String(r)); }
function ownNames(o: any) { return Object.keys(o).join(); }
function deed(o: any, v: V, k: string): any { let r: any; r = delete o.slot; return r; }
function attempt(i: number) { kept = []; const o = below(makeAbove()); const v = new V(i); let r: any; try { r = showResult(deed(o, v, "sl" + "ot")); } catch (e: any) { r = "threw " + e.name; } return r + " | " + showValue(v) + " | " + ownNames(o) + " | " + kept.length + " " + (kept[0] === v); }
console.log(attempt(1), "//", attempt(2));
let all = ""; for (let i = 0; i < 3; i++) all += attempt(i) + ";"; console.log(all);

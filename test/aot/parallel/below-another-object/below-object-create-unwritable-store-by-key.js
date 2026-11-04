// An object stands below another (object create), where a property that cannot be written stands under `slot`: store by key (erased).
class V { constructor(i) { this.from = "here" + i; this.gone = i; } }
class Plain { own = 1; }
let kept = [];
function makeAbove() { return Object.defineProperty({}, "slot", { value: 1, writable: false, enumerable: true, configurable: true }); }
function below(above) { return Object.create(above); }
function lengthOf(p) { return typeof p.from === "string" ? p.from.length : -1; }
function showValue(p) { return typeof p.from + " " + p.from + " " + lengthOf(p) + " " + ("gone" in p) + " " + p.gone + " " + Object.keys(p).join(); }
function showResult(r) { return r === undefined ? "undefined" : typeof r === "object" || typeof r === "function" ? typeof r : typeof r + ":" + (String(r).length > 30 ? "long" : String(r)); }
function ownNames(o) { return Object.keys(o).join(); }
function deed(o, v, k) { let r; o[k] = v; return r; }
function attempt(i) { kept = []; const o = below(makeAbove()); const v = new V(i); let r; try { r = showResult(deed(o, v, "sl" + "ot")); } catch (e) { r = "threw " + e.name; } return r + " | " + showValue(v) + " | " + ownNames(o) + " | " + kept.length + " " + (kept[0] === v); }
console.log(attempt(1), "//", attempt(2));
let all = ""; for (let i = 0; i < 3; i++) all += attempt(i) + ";"; console.log(all);

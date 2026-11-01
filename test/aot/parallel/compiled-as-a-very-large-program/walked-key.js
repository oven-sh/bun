// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out goes into a field, and the program spells that name nowhere as a string.
function point(k) { return { q: k }; }
function intoField(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.q in { text: 1 }); }
  return r + "|" + Object.keys(x).join("+") + typeof x.q + ":" + x.q;
}
function pair(k) { return { p: k }; }
function byVariable(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (const k in { word: 1, more: 2 }) x.p = k; }
  return r + "|" + Object.keys(x).join("+") + typeof x.p + ":" + x.p;
}
class Walked { inside = 1; }
function spot(k) { return { s: k }; }
function ofInstance(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.s in new Walked()); }
  return r + "|" + Object.keys(x).join("+") + typeof x.s + ":" + x.s;
}
let kept = 0;
function read() { return kept; }
function mark(k) { return { m: k }; }
function byModuleVariable(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (kept in { held: 1 }); x.m = read(); }
  return r + "|" + Object.keys(x).join("+") + typeof x.m + ":" + x.m;
}
console.log(intoField(point(0), false), intoField(point(7), true));
console.log(byVariable(pair(0), false), byVariable(pair(7), true));
console.log(ofInstance(spot(0), false), ofInstance(spot(7), true));
console.log(byModuleVariable(mark(0), false), byModuleVariable(mark(7), true));

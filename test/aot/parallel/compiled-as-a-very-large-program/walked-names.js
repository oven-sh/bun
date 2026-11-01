// Flags: --aot-heat=ReadOffStructure
// As walked-key.js, for other names that a walk lists: of a getter, of what is inherited, of a store in a constructor, behind a delete, an index, of a prototype written in the literal.
function make_getter(k) { return { f0: k }; }
function getter(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.f0 in { get gotten() { return 1; } }); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f0 + ":" + x.f0;
}
function make_inherited(k) { return { f1: k }; }
function inherited(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.f1 in Object.create({ handedDown: 1 })); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f1 + ":" + x.f1;
}
class Kept { constructor() { this.storedLater = 1; } }
function make_stored(k) { return { f2: k }; }
function stored(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.f2 in new Kept()); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f2 + ":" + x.f2;
}
function make_deleted(k) { return { f3: k }; }
function deleted(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { const d = { gone: 1, stays: 2 }; delete d.gone; for (x.f3 in d); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f3 + ":" + x.f3;
}
function make_index(k) { return { f4: k }; }
function index(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.f4 in { 7: 1 }); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f4 + ":" + x.f4;
}
function make_above(k) { return { f5: k }; }
function above(x, go) {
  let r = Object.keys(x).join("+");
  if (go) { for (x.f5 in { __proto__: { fromAbove: 1 } }); }
  return r + "|" + Object.keys(x).join("+") + typeof x.f5 + ":" + x.f5;
}
console.log(getter(make_getter(0), false), getter(make_getter(7), true));
console.log(inherited(make_inherited(0), false), inherited(make_inherited(7), true));
console.log(stored(make_stored(0), false), stored(make_stored(7), true));
console.log(deleted(make_deleted(0), false), deleted(make_deleted(7), true));
console.log(index(make_index(0), false), index(make_index(7), true));
console.log(above(make_above(0), false), above(make_above(7), true));

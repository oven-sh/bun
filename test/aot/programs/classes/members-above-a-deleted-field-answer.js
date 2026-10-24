// A field that shadows a member of a class above is deleted: from then on the member above answers.
const lines = [];
const note = (what, action) => { try { lines.push(what + ": " + action()); } catch (error) { lines.push(what + ": " + error.name + " " + error.message); } };

class Above {
  get g() { return "the getter above"; }
  set s(value) { lines.push("the setter above got " + value); }
  m() { return "the method above"; }
  get both() { return "both, read"; }
  set both(value) { lines.push("both got " + value); }
}
Object.defineProperty(Above.prototype, "fixed", { value: "fixed above", writable: false, configurable: true });
Above.prototype.plain = "plain above";

class Below extends Above { g = 1; s = 2; m = 3; both = 4; fixed = 5; plain = 6; }

function reads(o) { return [o.g, o.s, typeof o.m === "function" ? o.m() : o.m, o.both, o.fixed, o.plain].join(" | "); }
function stores(o, value) {
  "use strict";
  for (const store of [() => { o.g = value; }, () => { o.s = value; }, () => { o.m = value; }, () => { o.both = value; }, () => { o.fixed = value; }, () => { o.plain = value; }])
    note("store", () => { store(); return "done"; });
}
function removeAll(o) { delete o.g; delete o.s; delete o.m; delete o.both; delete o.fixed; delete o.plain; }

function round() {
  const o = new Below;
  note("born", () => reads(o));
  stores(o, 10);
  note("stored", () => reads(o));
  removeAll(o);
  note("deleted", () => reads(o));
  stores(o, 20);
  note("stored behind the delete", () => reads(o));
  note("own", () => ["g", "s", "m", "both", "fixed", "plain"].map(name => Object.hasOwn(o, name)).join());
  removeAll(o);
  note("spread defines", () => { const copy = { ...o }; return Object.keys(copy).join(); });
  note("assign from a literal", () => { Object.assign(o, { plain: 30, m: 31 }); return reads(o); });
  note("assign that meets the setter", () => { Object.assign(o, { s: 32, both: 33 }); return reads(o); });
  note("assign that meets the getter alone", () => { Object.assign(o, { g: 34 }); return reads(o); });
  note("assign that meets the read-only one", () => { Object.assign(o, { fixed: 35 }); return reads(o); });
}
for (let turn = 0; turn < 60; turn++) {
  if (turn && turn < 59)
    lines.length = 0;
  round();
}
console.log(lines.join("\n"));

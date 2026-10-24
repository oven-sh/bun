function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

console.log("strict code:", (function () { return this === undefined; })());

function addPosition(target, left, top) {
  target.left = left;
  target.top = top;
}

function addSize() {
  this.wide = 10;
  this.tall = 20;
}

function addSizeBackwards() {
  this.tall = "tall first";
  this.wide = "wide second";
}

function addNothing() {}

function addAndFreeze() {
  this.wide = 10;
  Object.freeze(this);
}

function addThenReturnAnother() {
  this.wide = 10;
  return { wide: "returned by the helper" };
}

const sizers = {
  usual: addSize,
  backwards: addSizeBackwards,
  nothing: addNothing,
  freezes: addAndFreeze,
  returns: addThenReturnAnother,
  arrow: () => { this.wide = "stored by an arrow function"; },
  bound: addSize.bind({ note: "bound to another object" }),
};

let currentSizer = addSize;

function Widget(left, top, sizer) {
  addPosition(this, left, top);
  sizers[sizer].call(this);
  this.label = "widget";
}
Widget.prototype.box = function () {
  return [this.left, this.top, this.wide, this.tall].join();
};

function Gadget(left, top) {
  addPosition(this, left, top);
  currentSizer.call(this);
  this.label = "gadget";
}
Gadget.prototype.box = Widget.prototype.box;

function Gizmo(left, top) {
  this.init(left, top);
  this.label = "gizmo";
}
Gizmo.prototype.init = function (left, top) {
  addPosition(this, left, top);
  addSize.call(this);
};
Gizmo.prototype.box = Widget.prototype.box;

function boxOf(thing) {
  return thing.box();
}

function wideOf(thing) {
  return thing.wide;
}

let length = 0;
for (let i = 0; i < 2000; i++) length += boxOf(new Widget(i % 3, 1, "usual")).length + boxOf(new Gadget(i % 3, 1)).length + boxOf(new Gizmo(i % 3, 1)).length + wideOf(new Widget(1, 1, "usual"));
console.log("2000 honest constructions each", length);

for (const name of Object.keys(sizers)) {
  attempt("Widget sized by " + name, () => new Widget(1, 2, name));
  attempt("Widget sized by " + name + ": box()", () => boxOf(new Widget(1, 2, name)));
  attempt("Widget sized by " + name + ": wide", () => wideOf(new Widget(1, 2, name)));
}
attempt("what the arrow function stored into", () => [typeof module.exports.wide, delete module.exports.wide]);
attempt("Widget sized by a name that is missing", () => new Widget(1, 2, "missing"));

for (const name of Object.keys(sizers)) {
  currentSizer = sizers[name];
  attempt("Gadget while the helper variable holds " + name, () => new Gadget(1, 2));
  attempt("Gadget while the helper variable holds " + name + ": box()", () => boxOf(new Gadget(1, 2)));
}
currentSizer = addSize;
delete module.exports.wide;

attempt("Gizmo", () => new Gizmo(1, 2));
Gizmo.prototype.init = function (left) {
  this.only = left;
};
attempt("Gizmo after init was replaced", () => new Gizmo(1, 2));
attempt("Gizmo after init was replaced: box()", () => boxOf(new Gizmo(1, 2)));

function SubGizmo(left, top) {
  Gizmo.call(this, left, top);
}
SubGizmo.prototype = Object.create(Gizmo.prototype);
SubGizmo.prototype.init = function (left, top) {
  this.top = top;
  this.left = left;
  this.sub = true;
};
attempt("a child overrides init", () => new SubGizmo(1, 2));
attempt("a child overrides init: box()", () => boxOf(new SubGizmo(1, 2)));

attempt("addPosition with a literal", () => { const target = { top: "first" }; addPosition(target, 1, 2); return target; });
attempt("addPosition with a frozen literal", () => { const target = Object.freeze({}); addPosition(target, 1, 2); return target; });
attempt("addPosition with a number", () => addPosition(5, 1, 2));
attempt("addPosition with null", () => addPosition(null, 1, 2));
attempt("honest again", () => [boxOf(new Widget(1, 2, "usual")), boxOf(new Gadget(1, 2))]);

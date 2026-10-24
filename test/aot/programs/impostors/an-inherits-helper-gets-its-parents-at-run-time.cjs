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

function extend(Child, Parent) {
  Child.prototype = Object.create(Parent.prototype);
  Child.prototype.constructor = Child;
  Child.parent = Parent;
}

function Metal() {
  this.shine = "metal shine";
}
Metal.prototype.ring = function () {
  return "metal rings with " + this.shine;
};

function Wood() {
  this.grain = "wood grain";
}
Wood.prototype.ring = function () {
  return "wood knocks with " + this.grain;
};

function Glass() {
  this.shine = "glass shine";
  this.grain = "no grain";
}
Glass.prototype.ring = function () {
  return "glass chimes with " + this.shine;
};

const materials = { Metal, Wood, Glass };

function ringOf(thing) {
  return thing.ring();
}

function defineTool(parentName) {
  function Tool() {
    Tool.parent.call(this);
    this.tool = true;
  }
  extend(Tool, materials[parentName]);
  return Tool;
}

for (const name of ["Metal", "Wood", "Glass", "Metal"]) {
  const Tool = defineTool(name);
  let length = 0;
  for (let i = 0; i < 700; i++) length += ringOf(new Tool()).length;
  console.log("a tool of " + name + ", 700 calls", length);
  attempt("a tool of " + name, () => new Tool());
  attempt("a tool of " + name + " rings", () => ringOf(new Tool()));
  attempt("a tool of " + name + " instanceof Metal, Wood, Glass", () => [new Tool() instanceof Metal, new Tool() instanceof Wood, new Tool() instanceof Glass]);
}

function Spoon() {
  Spoon.parent.call(this);
}
function makeSpoon() {
  return new Spoon();
}
function Fork() {
  Fork.parent.call(this);
}
function makeFork() {
  return new Fork();
}
function Knife() {
  Knife.parent.call(this);
}
function makeKnife() {
  return new Knife();
}

const pairs = [
  [Spoon, Wood],
  [Fork, Metal],
  [Knife, Glass],
];
for (const [Child, Parent] of pairs) extend(Child, Parent);
for (const [Child, , make] of [[Spoon, Wood, makeSpoon], [Fork, Metal, makeFork], [Knife, Glass, makeKnife]]) attempt(Child.name + " linked in a loop over pairs", () => ringOf(make()));

const flag = JSON.parse("[true,false]");
extend(Spoon, flag[0] ? Metal : Wood);
extend(Fork, flag[1] ? Metal : Wood);
attempt("Spoon linked by a condition", () => ringOf(makeSpoon()));
attempt("Fork linked by a condition", () => ringOf(makeFork()));

extend.call(null, Knife, Wood);
attempt("Knife linked through call", () => ringOf(makeKnife()));
extend.apply(null, [Knife, Metal]);
attempt("Knife linked through apply", () => ringOf(makeKnife()));
[[Knife, Glass]].forEach(([Child, Parent]) => extend(Child, Parent));
attempt("Knife linked inside forEach", () => ringOf(makeKnife()));
[extend][0](Knife, Wood);
attempt("Knife linked through an element of a list", () => ringOf(makeKnife()));

const oldKnife = makeKnife();
extend(Knife, Metal);
attempt("a knife made before the last link", () => ringOf(oldKnife));
attempt("a knife made after it", () => ringOf(makeKnife()));
attempt("the old knife is a Knife", () => oldKnife instanceof Knife);

extend(Knife, Spoon);
attempt("Knife under Spoon under Metal", () => [ringOf(makeKnife()), makeKnife() instanceof Spoon, makeKnife() instanceof Metal]);
extend(Spoon, Glass);
attempt("Spoon was linked again, a new knife keeps Spoon's old prototype", () => [ringOf(makeKnife()), makeKnife() instanceof Spoon, makeKnife() instanceof Metal, makeKnife() instanceof Glass]);

attempt("a parent without a prototype", () => extend(Fork, () => {}));
attempt("a parent that is undefined", () => extend(Fork, undefined));
attempt("Fork after the failed links", () => ringOf(makeFork()));

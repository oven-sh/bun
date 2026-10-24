function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

console.log("strict code:", (function () { return this === undefined; })());

class Box {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

function OldBox(width, height) {
  this.width = width;
  this.height = height;
}
OldBox.prototype.area = function () {
  return this.width * this.height;
};

const kinds = [
  ["class", () => new Box(3, 4)],
  ["constructor function", () => new OldBox(3, 4)],
];

function readCallRead(box, between) {
  const first = box.width;
  between(box);
  return [first, box.width];
}

function readInALoop(box, between) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(box.width);
    if (i === 1) between(box);
  }
  return seen;
}

function callCallCall(box, between) {
  const first = box.area();
  between(box);
  return [first, box.area()];
}

function storeCallStore(box, between) {
  box.width = 10;
  between(box);
  box.width = 20;
  return box.width;
}

function readAddRead(box, between) {
  return box.width + { valueOf: () => (between(box), 1000) } + box.width;
}

function readInATemplate(box, between) {
  return `${box.width} ${{ toString: () => (between(box), "then") }} ${box.width}`;
}

function readSortRead(box, between) {
  const first = box.width;
  [2, 1].sort((a, b) => (between(box), a - b));
  return [first, box.width];
}

function readGetterRead(box, between) {
  const trigger = { get pull() { between(box); return "pulled"; } };
  return [box.width, trigger.pull, box.width];
}

const forms = [
  ["read, call, read", readCallRead],
  ["four reads in a loop", readInALoop],
  ["area(), call, area()", callCallCall],
  ["store, call, store", storeCallStore],
  ["width + valueOf + width", readAddRead],
  ["a template with toString in the middle", readInATemplate],
  ["read, a sort comparator, read", readSortRead],
  ["read, a getter of another object, read", readGetterRead],
];

function nothing() {}

const changes = [
  ["nothing", nothing],
  ["stores 7", box => { box.width = 7; }],
  ["stores a string", box => { box.width = "seven"; }],
  ["stores 1.5", box => { box.width = 1.5; }],
  ["deletes width", box => { delete box.width; }],
  ["deletes width and adds it again", box => { delete box.width; box.width = 8; }],
  ["turns width into a getter", box => { Object.defineProperty(box, "width", { get: () => "got", configurable: true }); }],
  ["makes width read-only", box => { Object.defineProperty(box, "width", { writable: false }); }],
  ["freezes it", box => { Object.freeze(box); }],
  ["adds a member", box => { box.depth = 1; }],
  ["gives it its own area", box => { box.area = () => "own area"; }],
  ["removes its prototype", box => { Object.setPrototypeOf(box, null); }],
  ["moves it under another prototype", box => { Object.setPrototypeOf(box, { area: () => "another area", width: "inherited" }); }],
  ["deletes width and moves it", box => { delete box.width; Object.setPrototypeOf(box, { width: "inherited", area: () => "another area" }); }],
];

for (let i = 0; i < 2000; i++) for (const [, make] of kinds) for (const [, form] of forms) form(make(), nothing);

for (const [kind, make] of kinds) {
  for (const [formLabel, form] of forms) {
    for (const [changeLabel, change] of changes) {
      let line = kind + " | " + formLabel + " | " + changeLabel + " -> ";
      const box = make();
      try {
        line += show(form(box, change));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line + " | keys " + Object.keys(box).join());
    }
  }
}

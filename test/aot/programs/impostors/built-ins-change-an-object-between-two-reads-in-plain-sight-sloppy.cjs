function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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
  reset() {
    this.width = "reset";
  }
  set both(value) {
    this.width = value;
    this.height = value;
  }
  get drained() {
    delete this.width;
    return true;
  }
}

function OldBox(width, height) {
  this.width = width;
  this.height = height;
}
OldBox.prototype.area = function () {
  return this.width * this.height;
};
OldBox.prototype.reset = function () {
  this.width = "reset";
};
Object.defineProperty(OldBox.prototype, "both", { set(value) { this.width = value; this.height = value; } });
Object.defineProperty(OldBox.prototype, "drained", { get() { delete this.width; return true; } });

const other = { area: () => "another area", width: "inherited" };

const steps = [
  ["nothing", box => { const a = box.width; return [a, box.width]; }],
  ["Object.assign", box => { const a = box.width; Object.assign(box, { width: "assigned" }); return [a, box.width]; }],
  ["Object.assign of two sources", box => { const a = box.width; Object.assign(box, { width: "first" }, { width: "second" }); return [a, box.width]; }],
  ["Object.defineProperty with a value", box => { const a = box.width; Object.defineProperty(box, "width", { value: "defined" }); return [a, box.width]; }],
  ["Object.defineProperty with a getter", box => { const a = box.width; Object.defineProperty(box, "width", { get: () => "got" }); return [a, box.width]; }],
  ["Object.defineProperties", box => { const a = box.width; Object.defineProperties(box, { width: { value: "defined" }, height: { value: "too" } }); return [a, box.width, box.height]; }],
  ["Reflect.set", box => { const a = box.width; Reflect.set(box, "width", "set"); return [a, box.width]; }],
  ["Reflect.set with another receiver", box => { const a = box.width; Reflect.set({}, "width", "set", box); return [a, box.width]; }],
  ["Reflect.defineProperty", box => { const a = box.width; Reflect.defineProperty(box, "width", { value: "defined" }); return [a, box.width]; }],
  ["delete", box => { const a = box.width; delete box.width; return [a, box.width]; }],
  ["Reflect.deleteProperty", box => { const a = box.width; Reflect.deleteProperty(box, "width"); return [a, box.width]; }],
  ["delete, then in", box => { const a = "width" in box; delete box.width; return [a, "width" in box]; }],
  ["delete, then keys", box => { const a = Object.keys(box).join(); delete box.width; return [a, Object.keys(box).join()]; }],
  ["freeze, then a store", box => { box.width = 1; Object.freeze(box); try { box.width = 2; } catch (error) { return [error.constructor.name, box.width]; } return ["no error", box.width]; }],
  ["seal, then a delete", box => { Object.seal(box); try { delete box.width; } catch (error) { return [error.constructor.name, box.width]; } return ["no error", box.width]; }],
  ["preventExtensions, then a new member", box => { Object.preventExtensions(box); try { box.depth = 2; } catch (error) { return [error.constructor.name, box.depth]; } return ["no error", box.depth]; }],
  ["setPrototypeOf, then a call", box => { const a = box.area(); Object.setPrototypeOf(box, other); return [a, box.area()]; }],
  ["Reflect.setPrototypeOf, then a call", box => { const a = box.area(); Reflect.setPrototypeOf(box, other); return [a, box.area()]; }],
  ["a store to __proto__, then a call", box => { const a = box.area(); box.__proto__ = other; return [a, box.area()]; }],
  ["setPrototypeOf to null, then a call", box => { const a = box.area(); Object.setPrototypeOf(box, null); try { return [a, box.area()]; } catch (error) { return [a, error.constructor.name]; } }],
  ["delete and setPrototypeOf, then a read", box => { const a = box.width; delete box.width; Object.setPrototypeOf(box, other); return [a, box.width]; }],
  ["an object pattern that stores", box => { const a = box.width; ({ found: box.width } = { found: "destructured" }); return [a, box.width]; }],
  ["an array pattern that stores", box => { const a = box.width; [box.width] = ["destructured"]; return [a, box.width]; }],
  ["a for-of head that stores", box => { const a = box.width; for (box.width of ["looped"]); return [a, box.width]; }],
  ["a for-in head that stores", box => { const a = box.width; for (box.width in { name: 1 }); return [a, box.width]; }],
  ["forEach over entries", box => { const a = box.width; Object.entries({ width: "entry" }).forEach(([name, value]) => { box[name] = value; }); return [a, box.width]; }],
  ["its own method", box => { const a = box.width; box.reset(); return [a, box.width]; }],
  ["its own setter", box => { const a = box.width; box.both = "both"; return [a, box.width, box.height]; }],
  ["its own getter", box => { const a = box.width; const b = box.drained; return [a, b, box.width]; }],
  ["an own method added, then a call", box => { const a = box.area(); box.area = () => "own area"; return [a, box.area()]; }],
  ["a swap of the two fields", box => { [box.width, box.height] = [box.height, box.width]; return [box.width, box.height]; }],
  ["a store of another type, then arithmetic", box => { const a = box.width + 1; box.width = "3"; return [a, box.width + 1, box.area()]; }],
  ["a store of a fraction, then arithmetic", box => { const a = box.width + 1; box.width = 0.5; return [a, box.width + 1, box.area()]; }],
  ["a store through a second name", box => { const same = box; const a = box.width; same.width = "aliased"; return [a, box.width]; }],
  ["a store through an array that holds it", box => { const list = [box]; const a = box.width; list[0].width = "through the list"; return [a, box.width]; }],
  ["a store through a closure", box => { const a = box.width; (() => { box.width = "closure"; })(); return [a, box.width]; }],
];

const kinds = [
  ["class", () => new Box(3, 4)],
  ["constructor function", () => new OldBox(3, 4)],
];

for (let i = 0; i < 2000; i++) for (const [, make] of kinds) for (const [, step] of steps) step(make());

for (const [kind, make] of kinds) {
  for (const [label, step] of steps) {
    const box = make();
    let line = kind + " | " + label + " -> ";
    try {
      line += show(step(box));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | keys " + Object.keys(box).join());
  }
}

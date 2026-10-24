import * as boxModule from "./box.mjs";
import * as lateModule from "./late.mjs";
import { resize } from "./box.mjs";

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Box {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

const uses = [
  ["box.width", box => box.width],
  ["width, a resize, width", box => { const first = box.width; resize(7, 8); const second = box.width; resize(3, 4); return [first, second]; }],
  ["box.area()", box => box.area()],
  ["area taken off", box => { const area = box.area; return area(); }],
  ["{ width, height }", box => { const { width, height } = box; return [width, height]; }],
  ["{ width, ...rest }", box => { const { width, ...rest } = box; return [width, Object.keys(rest)]; }],
  ["box.width = 9", box => { box.width = 9; return box.width; }],
  ["box.width++", box => box.width++],
  ["box.depth = 9", box => { box.depth = 9; return box.depth; }],
  ["delete box.width", box => delete box.width],
  ["delete box.depth", box => delete box.depth],
  ['"width" in box', box => "width" in box],
  ["for-in", box => { const names = []; for (const name in box) names.push(name); return names; }],
  ["keys", box => Object.keys(box)],
  ["ownKeys", box => Reflect.ownKeys(box).map(String)],
  ["spread", box => ({ ...box })],
  ["assign", box => Object.assign({}, box)],
  ["json", box => JSON.stringify(box)],
  ["the descriptor of width", box => Object.getOwnPropertyDescriptor(box, "width")],
  ["its prototype is null", box => Object.getPrototypeOf(box) === null],
  ["extensible, sealed, frozen", box => [Object.isExtensible(box), Object.isSealed(box), Object.isFrozen(box)]],
  ["Object.freeze", box => Object.isFrozen(Object.freeze(box))],
  ["defineProperty with the same value", box => Reflect.defineProperty(box, "width", { value: box.width })],
  ["defineProperty with another value", box => Reflect.defineProperty(box, "width", { value: 99 })],
  ["setPrototypeOf to null, to an object", box => [Reflect.setPrototypeOf(box, null), Reflect.setPrototypeOf(box, {})]],
  ["in a template", box => `${box}`],
  ["toString tag", box => Object.prototype.toString.call(box)],
  ["instanceof Box", box => box instanceof Box],
];

function look(label, make) {
  for (const [name, use] of uses) {
    let line = label + " | " + name + " -> ";
    try {
      line += show(use(make()));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line);
  }
}

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) {
    try {
      use(new Box(3, 4));
    } catch {}
  }
}

look("an honest box", () => new Box(3, 4));
look("the namespace object", () => boxModule);
look("an object that inherits from it", () => Object.create(boxModule));
look("an honest box again", () => new Box(3, 4));
console.log("what a module saw of itself before its variables were set:", lateModule.seenEarly.join(" | "));
console.log("and afterwards:", lateModule.width, lateModule.height);
const loaded = await import("./" + ["bo", "x"].join("") + ".mjs");
console.log("the namespace object loaded by a computed name is the same:", loaded === boxModule);

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Box {
  constructor(width) {
    this.width = width;
    this.height = 4;
  }
}

function OldBox(width) {
  this.width = width;
  this.height = 4;
}

let strike = null;

function hit() {
  if (strike) strike();
}

const trap = {
  valueOf() { hit(); return 1; },
  toString() { hit(); return "key"; },
  toJSON() { hit(); return 1; },
  get member() { hit(); return 1; },
  set member(value) { hit(); },
  [Symbol.iterator]() { hit(); return [][Symbol.iterator](); },
  [Symbol.hasInstance]() { hit(); return true; },
  get then() { hit(); return undefined; },
};
const proxy = new Proxy({}, {
  has() { hit(); return true; },
  get() { hit(); return 1; },
  set() { hit(); return true; },
  deleteProperty() { hit(); return true; },
  ownKeys() { hit(); return []; },
  getPrototypeOf() { hit(); return null; },
});
const callable = new Proxy(function () {}, { apply() { hit(); }, construct() { hit(); return {}; } });

const operations = [
  ["nothing", box => { const a = box.width; return [a, box.width]; }],
  ["+trap", box => { const a = box.width; const b = +trap; return [a, box.width, typeof b]; }],
  ["trap + 1", box => { const a = box.width; const b = trap + 1; return [a, box.width, typeof b]; }],
  ["trap < 2", box => { const a = box.width; const b = trap < 2; return [a, box.width, typeof b]; }],
  ["trap == 1", box => { const a = box.width; const b = trap == 1; return [a, box.width, typeof b]; }],
  ["trap | 0", box => { const a = box.width; const b = trap | 0; return [a, box.width, typeof b]; }],
  ["a template", box => { const a = box.width; const b = `${trap}`; return [a, box.width, typeof b]; }],
  ["String(trap)", box => { const a = box.width; const b = String(trap); return [a, box.width, typeof b]; }],
  ["trap as a key", box => { const a = box.width; const b = ({})[trap]; return [a, box.width, typeof b]; }],
  ["trap as a key of the box", box => { const a = box.width; const b = box[trap]; return [a, box.width, typeof b]; }],
  ["trap.member", box => { const a = box.width; const b = trap.member; return [a, box.width, typeof b]; }],
  ["trap.member = 1", box => { const a = box.width; const b = trap.member = 1; return [a, box.width, typeof b]; }],
  ["{ member } = trap", box => { const a = box.width; const { member } = trap; return [a, box.width]; }],
  ["{ ...trap }", box => { const a = box.width; const b = ({ ...trap }); return [a, box.width, typeof b]; }],
  ["[...trap]", box => { const a = box.width; const b = [...trap]; return [a, box.width, typeof b]; }],
  ["for of trap", box => { const a = box.width; for (const each of trap); return [a, box.width]; }],
  ["[] = trap", box => { const a = box.width; const [] = trap; return [a, box.width]; }],
  ["1 instanceof trap", box => { const a = box.width; const b = 1 instanceof trap; return [a, box.width, typeof b]; }],
  ["JSON.stringify(trap)", box => { const a = box.width; const b = JSON.stringify(trap); return [a, box.width, typeof b]; }],
  ["Object.assign({}, trap)", box => { const a = box.width; const b = Object.assign({}, trap); return [a, box.width, typeof b]; }],
  ["Math.max(trap)", box => { const a = box.width; const b = Math.max(trap); return [a, box.width, typeof b]; }],
  ["[trap].join()", box => { const a = box.width; const b = [trap].join(); return [a, box.width, typeof b]; }],
  ["'x'.repeat(trap)", box => { const a = box.width; const b = "x".repeat(trap); return [a, box.width, typeof b]; }],
  ["[1, 2].at(trap)", box => { const a = box.width; const b = [1, 2].at(trap); return [a, box.width, typeof b]; }],
  ["Promise.resolve(trap)", box => { const a = box.width; const b = Promise.resolve(trap); return [a, box.width, typeof b]; }],
  ["'x' in proxy", box => { const a = box.width; const b = "x" in proxy; return [a, box.width, typeof b]; }],
  ["proxy.x", box => { const a = box.width; const b = proxy.x; return [a, box.width, typeof b]; }],
  ["proxy.x = 1", box => { const a = box.width; const b = proxy.x = 1; return [a, box.width, typeof b]; }],
  ["delete proxy.x", box => { const a = box.width; const b = delete proxy.x; return [a, box.width, typeof b]; }],
  ["Object.keys(proxy)", box => { const a = box.width; const b = Object.keys(proxy); return [a, box.width, typeof b]; }],
  ["for in proxy", box => { const a = box.width; for (const name in proxy); return [a, box.width]; }],
  ["proxy instanceof Box", box => { const a = box.width; const b = proxy instanceof Box; return [a, box.width, typeof b]; }],
  ["callable()", box => { const a = box.width; const b = callable(); return [a, box.width, typeof b]; }],
  ["new callable()", box => { const a = box.width; const b = new callable(); return [a, box.width, typeof b]; }],
  ["a tagged template", box => { const a = box.width; const b = callable``; return [a, box.width, typeof b]; }],
];

const strikes = [
  ["stores a string", box => { box.width = "struck"; }],
  ["deletes width", box => { delete box.width; }],
  ["turns width into a getter", box => { Object.defineProperty(box, "width", { get: () => "getter", configurable: true }); }],
];

for (let i = 0; i < 2000; i++) for (const [, operation] of operations) operation(i % 2 ? new Box(3) : new OldBox(3));

for (const [kind, make] of [["class", () => new Box(3)], ["constructor function", () => new OldBox(3)]]) {
  for (const [label, operation] of operations) {
    const results = strikes.map(([strikeLabel, change]) => {
      const box = make();
      strike = () => change(box);
      let result;
      try {
        result = show(operation(box));
      } catch (error) {
        result = "threw " + error.constructor.name;
      }
      strike = null;
      return strikeLabel + " " + result;
    });
    console.log(kind + " | " + label + " | " + results.join(" | "));
  }
}

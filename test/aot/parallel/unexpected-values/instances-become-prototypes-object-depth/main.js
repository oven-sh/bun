// instances-become-prototypes-of-other-objects.js, in a program where a further object has a `depth` and no `width`: the well of a shaft. The loop asks a child for its `width`, which instances and
// literals have, and for its `depth`, which a literal gets later and the well has. look() asks for both again behind the loop.
import "./global-variables-that-nobody-declares.js";
class Shaft {
  well = { depth: 1 };
}
const shaft = new Shaft();
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function OldBox(width, height) {
  this.width = width;
  this.height = height;
}
OldBox.prototype.area = function () {
  return this.width * this.height;
};

function makeLiteral(width, height) {
  return {
    width,
    height,
    area() {
      return this.width * this.height;
    },
  };
}

function widthOf(thing) {
  return thing.width;
}

function depthOf(thing) {
  return thing.depth;
}

function areaOf(thing) {
  return thing.area();
}

function hasDepth(thing) {
  return "depth" in thing;
}

function setWidth(box, value) {
  box.width = value;
}

function setDepth(box, value) {
  box.depth = value;
}

function walk(thing) {
  const names = [];
  for (const name in thing) names.push(name);
  return names.join();
}

const kinds = [
  ["class", () => new Box(3, 4)],
  ["constructor function", () => new OldBox(3, 4)],
  ["literal", () => makeLiteral(3, 4)],
];

const ways = [
  ["Object.create", parent => Object.create(parent)],
  ["Object.setPrototypeOf", parent => Object.setPrototypeOf({}, parent)],
  ["a literal with __proto__", parent => ({ __proto__: parent })],
  [
    "a store to __proto__",
    parent => {
      const child = {};
      child.__proto__ = parent;
      return child;
    },
  ],
  [
    "the prototype property of a function",
    parent => {
      function Child() {}
      Child.prototype = parent;
      return new Child();
    },
  ],
  [
    "Reflect.construct with such a function",
    parent => {
      function Child() {}
      Child.prototype = parent;
      return Reflect.construct(Object, [], Child);
    },
  ],
  ["Object.create reached by a joined name", parent => Object[["cre", "ate"].join("")](parent)],
  ["two levels of Object.create", parent => Object.create(Object.create(parent))],
  [
    "another instance moved under it",
    parent => {
      const child = new Box(1, 2);
      delete child.width;
      delete child.height;
      return Object.setPrototypeOf(child, parent);
    },
  ],
];

function look(child) {
  return [widthOf(child), depthOf(child), hasDepth(child), areaOf(child), walk(child)].map(show).join(" ");
}

for (const [kind, make] of kinds) {
  for (const [way, derive] of ways) {
    const parent = make();
    const child = derive(parent);
    let sum = 0;
    for (let i = 0; i < 700; i++) {
      sum += widthOf(child) + areaOf(child) + (depthOf(child) === undefined ? 1 : 0) + (hasDepth(child) ? 0 : 1);
      sum += widthOf(parent);
    }
    const where = kind + " | " + way + " | ";
    console.log(where + "700 rounds " + sum + " | " + look(child));
    setWidth(parent, 9);
    console.log(where + "the parent's width was stored to -> " + look(child));
    setWidth(parent, "wide");
    console.log(where + "with a string -> " + look(child));
    setDepth(parent, 7);
    console.log(where + "the parent got a depth -> " + look(child));
    delete parent.depth;
    console.log(where + "and lost it -> " + look(child));
    delete parent.width;
    console.log(where + "the parent lost its width -> " + look(child));
    setWidth(parent, 2);
    console.log(where + "and got it back -> " + look(child));
    Object.defineProperty(parent, "width", {
      get() {
        return this === child ? "getter, this is the child" : "getter, this is someone else";
      },
      configurable: true,
      enumerable: true,
    });
    console.log(where + "the parent's width became a getter -> " + look(child));
    try {
      setWidth(child, 1);
      console.log(where + "a store to the child under that getter -> " + look(child));
    } catch (error) {
      console.log(where + "a store to the child under that getter threw " + error.constructor.name);
    }
    Object.defineProperty(parent, "width", { value: 6, writable: true, enumerable: true, configurable: true });
    setWidth(child, 1);
    console.log(
      where +
        "a store to the child shadows a plain width -> " +
        look(child) +
        " | the parent has " +
        show(widthOf(parent)),
    );
    delete child.width;
    Object.freeze(parent);
    try {
      setWidth(child, 1);
      console.log(where + "a store to the child of a frozen parent -> " + look(child));
    } catch (error) {
      console.log(where + "a store to the child of a frozen parent threw " + error.constructor.name);
    }
  }
}
console.log("honest again", widthOf(new Box(3, 4)), areaOf(new OldBox(3, 4)), show(depthOf(makeLiteral(3, 4))));
console.log("the well is", shaft.well.depth, "deep, and a stream is a", typeof stream);

// A base class that returns its argument lets a subclass add private fields, methods and accessors to any object. Copies of that object get its properties but nothing private.
const name = process.argv[2] ?? "z";

class Returned {
  constructor(object) {
    return object;
  }
}

class Field extends Returned {
  #mark = 1;
  static has(object) {
    return #mark in object;
  }
  static read(object) {
    return object.#mark;
  }
}

class Method extends Returned {
  #mark() {
    return 2;
  }
  static has(object) {
    return #mark in object;
  }
  static read(object) {
    return object.#mark();
  }
}

class Accessor extends Returned {
  get #mark() {
    return 3;
  }
  static has(object) {
    return #mark in object;
  }
  static read(object) {
    return object.#mark;
  }
}

const fill = [
  ["nothing", () => {}],
  [
    "a name first",
    source => {
      source[name] = 2;
    },
  ],
  [
    "a symbol first",
    source => {
      source[Symbol.for("first")] = 2;
    },
  ],
];

const copy = [
  ["spread", source => ({ ...source })],
  ["spread, then a name", source => ({ ...source, last: 1 })],
  ["spread, then an index", source => ({ ...source, 1: 1 })],
  ["spread twice", source => ({ ...source, ...source })],
  [
    "rest",
    source => {
      const { ...rest } = source;
      return rest;
    },
  ],
  [
    "rest without a member",
    source => {
      const { a, ...rest } = source;
      return rest;
    },
  ],
  ["Object.assign to an empty object", source => Object.assign({}, source)],
  ["Object.assign to the same members", source => Object.assign({ a: 0, b: "" }, source)],
  ["structuredClone", source => structuredClone(source)],
  ["Object.fromEntries", source => Object.fromEntries(Object.entries(source))],
];

for (const Stamp of [Field, Method, Accessor]) {
  for (const [filled, fillSource] of fill) {
    for (const [copied, copySource] of copy) {
      for (let round = 0; round < 3; round++) {
        const source = { a: 1, b: "x" };
        fillSource(source);
        new Stamp(source);
        const target = copySource(source);
        let read;
        try {
          read = Stamp.read(target);
        } catch (error) {
          read = error.constructor.name;
        }
        const hadMark = Stamp.has(target);
        new Stamp(target);
        console.log(
          `${Stamp.name} | ${filled} | ${copied}: ${Stamp.has(source)} ${hadMark} ${read} ${Stamp.has(target)} ${Reflect.ownKeys(target).map(String).join()}`,
        );
      }
    }
  }
}

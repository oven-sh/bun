function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

const parent = {
  greeting: "inherited greeting",
  greet() {
    return "hello from " + this.title;
  },
};

function greetingOf(thing) {
  return thing.greeting;
}

function greet(thing) {
  return thing.greet();
}

function look(label, make) {
  let line = label + " -> ";
  try {
    const thing = make();
    line += "parent is the parent: " + (Object.getPrototypeOf(thing) === parent);
    line += " | owns __proto__: " + Object.hasOwn(thing, "__proto__");
    line += " | keys " + Object.keys(thing).join();
    line += " | greeting " + show(greetingOf(thing));
    try {
      line += " | greet() " + show(greet(thing));
    } catch (error) {
      line += " | greet() threw " + error.constructor.name;
    }
  } catch (error) {
    line += "threw " + error.constructor.name;
  }
  console.log(line);
}

const name = "__proto__";
const __proto__ = parent;

const cases = [
  ["{ __proto__: parent }", () => ({ __proto__: parent, title: "a" })],
  ['{ "__proto__": parent }', () => ({ "__proto__": parent, title: "b" })],
  ['{ ["__proto__"]: parent }', () => ({ ["__proto__"]: parent, title: "c" })],
  ["{ [name]: parent }", () => ({ [name]: parent, title: "d" })],
  ["{ __proto__ } shorthand", () => ({ __proto__, title: "e" })],
  ["{ __proto__() {} } method", () => ({ __proto__() {}, title: "f" })],
  ["{ __proto__: 5 }", () => ({ __proto__: 5, title: "g" })],
  ["{ __proto__: null }", () => ({ __proto__: null, title: "h" })],
  ["{ __proto__: undefined }", () => ({ __proto__: undefined, title: "i" })],
  ["thing.__proto__ = parent", () => { const thing = { title: "j" }; thing.__proto__ = parent; return thing; }],
  ["thing[name] = parent", () => { const thing = { title: "k" }; thing[name] = parent; return thing; }],
  ["thing.__proto__ = 5", () => { const thing = { title: "l" }; thing.__proto__ = 5; return thing; }],
  ["thing.__proto__ = null, then = parent", () => { const thing = { title: "m" }; thing.__proto__ = null; thing.__proto__ = parent; return thing; }],
  ["a store on an object without a prototype", () => { const thing = Object.create(null); thing.title = "n"; thing.__proto__ = parent; return thing; }],
  ["Object.assign from a literal with a computed __proto__", () => Object.assign({ title: "o" }, { ["__proto__"]: parent })],
  ["a spread of a literal with a computed __proto__", () => ({ title: "p", ...{ ["__proto__"]: parent } })],
  ["JSON.parse with a __proto__ member", () => JSON.parse('{"title":"q","__proto__":{"greeting":"parsed greeting"}}')],
  ["Object.assign from that parsed object", () => Object.assign({ title: "r" }, JSON.parse('{"__proto__":{"greeting":"parsed greeting"}}'))],
  ["defineProperty of __proto__", () => Object.defineProperty({ title: "s" }, "__proto__", { value: parent, enumerable: true })],
  ["a store on a frozen object", () => { const thing = Object.freeze({ title: "t" }); thing.__proto__ = parent; return thing; }],
  ["a store on an object that is not extensible", () => { const thing = Object.preventExtensions({ title: "u" }); thing.__proto__ = parent; return thing; }],
  ["a store that would make a cycle", () => { const thing = Object.create(parent); thing.title = "v"; parent.__proto__ = thing; return thing; }],
  ["the setter taken from Object.prototype", () => { const thing = { title: "w" }; Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(thing, parent); return thing; }],
  ["a class field named __proto__", () => new (class { __proto__ = parent; title = "x"; })()],
  ["this.__proto__ = parent in a constructor function", () => new (function Odd() { this.title = "y"; this.__proto__ = parent; })()],
  ["destructuring into thing.__proto__", () => { const thing = { title: "z" }; ({ found: thing.__proto__ } = { found: parent }); return thing; }],
];

for (const [label, make] of cases) look("at first, " + label, make);

let length = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { __proto__: parent, title: "honest" };
  length += greetingOf(honest).length + greet(honest).length;
}
console.log("2000 honest objects", length);

for (const [label, make] of cases) look("later, " + label, make);
console.log("the parent's own parent is still Object.prototype:", Object.getPrototypeOf(parent) === Object.prototype);

const log = [];
const catcher = {
  set late(value) {
    log.push("the setter of the new prototype got " + value);
  },
};

function makeSource() {
  const source = { early: 1 };
  Object.defineProperty(source, "__proto__", { value: catcher, enumerable: true });
  source.late = 2;
  return source;
}

function copyByAssign(source) {
  return Object.assign({}, source);
}

function copyBySpread(source) {
  return { ...source };
}

function copyByLoop(source) {
  const copy = {};
  for (const key in source) copy[key] = source[key];
  return copy;
}

function copyByEntries(source) {
  return Object.fromEntries(Object.entries(source));
}

for (let i = 0; i < 2000; i++) for (const copy of [copyByAssign, copyBySpread, copyByLoop, copyByEntries]) copy({ early: 1, late: 2 });

for (const [label, copy] of [
  ["Object.assign", copyByAssign],
  ["a spread", copyBySpread],
  ["a for-in loop", copyByLoop],
  ["entries and fromEntries", copyByEntries],
]) {
  const made = copy(makeSource());
  console.log(label + " of a source with an own __proto__ in the middle -> keys " + Reflect.ownKeys(made).join() + " | under the catcher: " + (Object.getPrototypeOf(made) === catcher) + " | log " + log.splice(0).join(", "));
  console.log(label + " of an honest source -> " + show(copy({ early: 1, late: 2 })));
}

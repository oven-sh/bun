function attempt(label, action) {
  try {
    console.log(`${label}: ${action()}`);
  } catch (error) {
    console.log(`${label}: ${error.name}: ${error.message}`);
  }
}

function sloppyDeleteName(base) {
  return delete base.target;
}

function strictDeleteName(base) {
  "use strict";
  return delete base.target;
}

function sloppyDeleteLength(base) {
  return delete base.length;
}

function strictDeleteLength(base) {
  "use strict";
  return delete base.length;
}

function sloppyDeleteKey(base, key) {
  return delete base[key];
}

function strictDeleteKey(base, key) {
  "use strict";
  return delete base[key];
}

function nonConfigurable() {
  return Object.defineProperty({}, "target", { value: 1, configurable: false });
}

const cases = [
  ["non-configurable", nonConfigurable],
  ["frozen", () => Object.freeze({ target: 1 })],
  ["sealed", () => Object.seal({ target: 1 })],
  ["absent", () => ({ other: 1 })],
  ["absent on frozen", () => Object.freeze({ other: 1 })],
  ["configurable", () => ({ target: 1 })],
];

for (const [label, create] of cases) {
  attempt(`${label}, sloppy by name`, () => sloppyDeleteName(create()));
  attempt(`${label}, strict by name`, () => strictDeleteName(create()));
  attempt(`${label}, sloppy by key`, () => sloppyDeleteKey(create(), "target"));
  attempt(`${label}, strict by key`, () => strictDeleteKey(create(), "target"));
}

attempt("array length, sloppy by name", () => sloppyDeleteLength([]));
attempt("array length, strict by name", () => strictDeleteLength([]));
attempt("array length, sloppy by key", () => sloppyDeleteKey([], "length"));
attempt("array length, strict by key", () => strictDeleteKey([], "length"));
attempt("string length, sloppy by name", () => sloppyDeleteLength("text"));
attempt("string length, strict by name", () => strictDeleteLength("text"));
attempt("string index, sloppy by key", () => sloppyDeleteKey("text", 0));
attempt("string index, strict by key", () => strictDeleteKey("text", 0));
attempt("frozen array element, sloppy", () => sloppyDeleteKey(Object.freeze([1]), 0));
attempt("frozen array element, strict", () => strictDeleteKey(Object.freeze([1]), 0));
attempt("array element past the end, strict", () => strictDeleteKey([1], 5));

const configurable = { target: 1, kept: 2 };
console.log(sloppyDeleteName(configurable), Object.keys(configurable).join());
const configurableStrict = { target: 1, kept: 2 };
console.log(strictDeleteKey(configurableStrict, "target"), Object.keys(configurableStrict).join());
const elements = [1, 2, 3];
console.log(strictDeleteKey(elements, 1), 1 in elements, elements.length);

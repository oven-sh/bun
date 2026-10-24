// A read learns where an ordinary object keeps the field. All objects of that structure die, a collection frees the structure, and hundreds of new structures are made, one of which gets the old one's id. In them the field stands elsewhere, is an accessor, or is missing.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

class Expected {
  constructor() {
    this.name = "expected";
    this.size = 1;
  }
}

function nameOf(value) {
  return value.name;
}
function sizeOf(value) {
  return value.size;
}
function hasName(value) {
  return "name" in value;
}

function shortLived(round) {
  // The key that depends on the round gives each round a structure of its own.
  const value = {};
  value["only in round " + round] = 0;
  value.pad = 1;
  value.name = "short-lived " + round;
  value.size = round;
  return value;
}
function teach(round) {
  const value = unknown(shortLived(round));
  return [nameOf(value), nameOf(value), sizeOf(value), sizeOf(value), hasName(value)].join();
}
function fillStack(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}

let wrong = 0;
function check(actual, expected, what) {
  if (actual !== expected) {
    wrong++;
    if (wrong < 10) console.log("WRONG:", what, String(actual), "instead of", String(expected));
  }
}

function successor(round, index) {
  const value = {};
  value["successor " + round + " " + index] = "not the name";
  switch (index % 6) {
    case 0:
      value.name = "name " + index;
      value.size = index;
      return [value, "name " + index, index];
    case 1:
      value.size = index;
      value.a = "not the name either";
      value.b = "nor this";
      value.name = "name " + index;
      return [value, "name " + index, index];
    case 2:
      value.a = "a";
      value.b = "b";
      value.c = "c";
      return [value, undefined, undefined];
    case 3:
      value.pad = "pad";
      Object.defineProperty(value, "name", { get: () => "getter " + index, enumerable: true, configurable: true });
      value.size = index;
      return [value, "getter " + index, index];
    case 4:
      value.pad = 1;
      value.size = "size first";
      value.name = index;
      return [value, index, "size first"];
    default:
      value.pad = 1;
      value.name = 0.5 + index;
      return [Object.freeze(value), 0.5 + index, undefined];
  }
}

for (let round = 0; round < 8; round++) {
  console.log(nameOf(new Expected()), teach(round));
  fillStack(50);
  Bun.gc(true);
  const kept = [];
  for (let index = 0; index < 600; index++) {
    const [value, name, size] = successor(round, index);
    kept.push(value);
    const hidden = unknown(value);
    check(nameOf(hidden), name, "name");
    check(sizeOf(hidden), size, "size");
    check(hasName(hidden), name !== undefined, "has");
  }
  console.log("round", round, "kept", kept.length, "wrong", wrong, nameOf(new Expected()), sizeOf(new Expected()));
}

export {};

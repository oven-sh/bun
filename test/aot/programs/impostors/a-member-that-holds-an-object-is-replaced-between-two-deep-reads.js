function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Size {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

class SizeTheOtherWayRound {
  constructor(width, height) {
    this.height = height;
    this.width = width;
  }
  area() {
    return "the other area";
  }
}

class Parcel {
  constructor(size) {
    this.size = size;
  }
  replaceSize(size) {
    this.size = size;
  }
}

function readStoreRead(parcel, next) {
  const first = parcel.size.width;
  parcel.size = next;
  return [first, parcel.size.width, parcel.size.height];
}

function readCallRead(parcel, next, replace) {
  const first = parcel.size.width;
  replace(parcel, next);
  return [first, parcel.size.width, parcel.size.height];
}

function readMethodRead(parcel, next) {
  const first = parcel.size.width;
  parcel.replaceSize(next);
  return [first, parcel.size.width, parcel.size.height];
}

function readAliasStoreRead(parcel, next, replace, alias) {
  const first = parcel.size.width;
  alias.size = next;
  return [first, parcel.size.width, parcel.size.height];
}

function readComputedStoreRead(parcel, next, replace, alias, name) {
  const first = parcel.size.width;
  parcel[name] = next;
  return [first, parcel.size.width, parcel.size.height];
}

function loopWithAStoreInside(parcel, next) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(parcel.size.width);
    if (i === 1) parcel.size = next;
  }
  return seen;
}

function callStoreCall(parcel, next) {
  const first = parcel.size.area();
  parcel.size = next;
  return [first, parcel.size.area()];
}

function keptThenReplaced(parcel, next) {
  const kept = parcel.size;
  parcel.size = next;
  return [kept.width, parcel.size.width, kept === parcel.size];
}

function storeThroughTheOldOne(parcel, next) {
  const kept = parcel.size;
  parcel.size = next;
  kept.width = "stored into the old one";
  return [kept.width, parcel.size.width];
}

const forms = [
  ["read, store, read", readStoreRead],
  ["read, a call that stores, read", readCallRead],
  ["read, a method that stores, read", readMethodRead],
  ["read, a store through another name for the parcel, read", readAliasStoreRead],
  ["read, a store under a computed name, read", readComputedStoreRead],
  ["a loop with a store inside", loopWithAStoreInside],
  ["area(), store, area()", callStoreCall],
  ["the old one is kept", keptThenReplaced],
  ["a store through the old one", storeThroughTheOldOne],
];

function replaceInSight(parcel, next) {
  parcel.size = next;
}
function replaceByReflect(parcel, next) {
  Reflect.set(parcel, ["si", "ze"].join(""), next);
}

const nexts = [
  ["another honest size", () => new Size(30, 40)],
  ["the other field order", () => new SizeTheOtherWayRound(30, 40)],
  ["a literal", () => ({ width: 30, height: 40 })],
  ["a literal with members in front", () => ({ depth: 1, color: 2, width: 30, height: 40 })],
  ["a size with strings", () => new Size("w", "h")],
  ["a size with a getter", () => Object.defineProperty(new Size(30, 40), "width", { get: () => "got" })],
  ["an empty literal", () => ({})],
  ["a string", () => "size"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
];

for (let i = 0; i < 2000; i++) {
  for (const [, form] of forms) {
    const parcel = new Parcel(new Size(3, 4));
    form(parcel, new Size(i % 5, 6), replaceInSight, parcel, "size");
  }
}

for (const [replaceLabel, replace] of [["a plain store", replaceInSight], ["Reflect.set and a joined name", replaceByReflect]]) {
  for (const [formLabel, form] of forms) {
    if (replace === replaceByReflect && form !== readCallRead) continue;
    for (const [nextLabel, makeNext] of nexts) {
      const parcel = new Parcel(new Size(3, 4));
      let line = formLabel + (form === readCallRead ? " (" + replaceLabel + ")" : "") + " | " + nextLabel + " -> ";
      try {
        line += show(form(parcel, makeNext(), replace, parcel, ["si", "ze"].join("")));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}

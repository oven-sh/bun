function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
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
    this.label = "parcel";
  }
}

function widthTimesHeight(parcel) {
  return parcel.size.width * parcel.size.height;
}

function widthHeightWidth(parcel) {
  return [parcel.size.width, parcel.size.height, parcel.size.width];
}

function areaThenWidth(parcel) {
  return [parcel.size.area(), parcel.size.width];
}

function widthsInALoop(parcel) {
  const widths = [];
  for (let i = 0; i < 5; i++) widths.push(parcel.size.width);
  return widths;
}

function storeThenRead(parcel) {
  parcel.size.width = 50;
  return parcel.size.width;
}

function guardedRead(parcel) {
  if (parcel.size instanceof Size) return parcel.size.width;
  return "not a size";
}

function checkedRead(parcel) {
  if (parcel.size !== null && parcel.size !== undefined) return parcel.size.width;
  return "nothing";
}

const uses = [
  ["size.width * size.height", widthTimesHeight],
  ["width, height, width", widthHeightWidth],
  ["area(), width", areaThenWidth],
  ["five widths in a loop", widthsInALoop],
  ["store to one, read another", storeThenRead],
  ["instanceof, then a read", guardedRead],
  ["a test for null, then a read", checkedRead],
];

function rotating(makers) {
  let reads = 0;
  return {
    label: "parcel",
    get size() {
      return makers[reads++ % makers.length]();
    },
  };
}

function rotatingOnAnHonestParcel(makers) {
  let reads = 0;
  return Object.defineProperty(new Parcel(null), "size", { get: () => makers[reads++ % makers.length](), enumerable: true });
}

const honest = () => new Size(3, 4);
const sequences = [
  ["a new honest size each time", [honest]],
  ["honest, then the other field order", [honest, () => new SizeTheOtherWayRound(30, 40)]],
  ["the other field order, then honest", [() => new SizeTheOtherWayRound(30, 40), honest]],
  ["honest, then a literal", [honest, () => ({ width: 300, height: 400 })]],
  ["honest, then a literal with more members in front", [honest, () => ({ depth: 1, color: 2, width: 300, height: 400 })]],
  ["honest, then strings in the fields", [honest, () => new Size("w", "h")]],
  ["honest, then null", [honest, () => null]],
  ["honest, then undefined", [honest, () => undefined]],
  ["honest, then a number", [honest, () => 5]],
  ["honest, then a string", [honest, () => "size"]],
  ["honest, then an empty literal", [honest, () => ({})]],
  ["honest, honest, then a size with a getter", [honest, honest, () => Object.defineProperty(new Size(3, 4), "width", { get: () => "from a getter" })]],
  ["null, then honest", [() => null, honest]],
];

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Parcel(new Size(i % 5, 2)));
console.log("honest", uses.map(([, use]) => show(use(new Parcel(new Size(3, 4))))).join(" ; "));

for (const [holder, wrap] of [
  ["a literal with a getter", rotating],
  ["an honest parcel whose size became a getter", rotatingOnAnHonestParcel],
]) {
  for (const [label, makers] of sequences) {
    for (const [name, use] of uses) {
      let line = holder + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(wrap(makers)));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}
console.log("honest again", uses.map(([, use]) => show(use(new Parcel(new Size(3, 4))))).join(" ; "));

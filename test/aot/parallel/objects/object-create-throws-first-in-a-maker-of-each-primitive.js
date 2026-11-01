// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Each maker is handed one object and one kind of value that is no object: its Object.create throws before its first stored value is computed.
let ran = 0;
function g() {
  return ++ran;
}
function ofNumber(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
function ofString(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
function ofUndefined(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
function ofBoolean(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
function ofBigInt(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
function ofSymbol(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
const attempt = (make, other) => {
  try {
    make(other);
    return "no throw";
  } catch (e) {
    return e.constructor.name + " " + e.message + " " + ran;
  }
};
console.log(
  ofNumber({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofNumber, 1),
);
console.log(
  ofString({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofString, "text"),
);
console.log(
  ofUndefined({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofUndefined, undefined),
);
console.log(
  ofBoolean({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofBoolean, true),
);
console.log(
  ofBigInt({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofBigInt, 5n),
);
console.log(
  ofSymbol({
    get size() {
      return this.items;
    },
  }).size,
  attempt(ofSymbol, Symbol("s")),
);

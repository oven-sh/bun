// Object.setPrototypeOf(C.prototype, other) hangs the prototype of a class under an ordinary object.
// First the object has the name already; then an empty object is hung in and gets the name afterwards; then the name arrives one level above that object.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Full {
  declare id: number;
  hint?: string;
  constructor(id: number) {
    delete this.hint;
    handOver(this);
    this.id = id;
  }
}
class Empty {
  declare id: number;
  hint?: string;
  constructor(id: number) {
    delete this.hint;
    handOver(this);
    this.id = id;
  }
}
class Deep {
  declare id: number;
  hint?: string;
  constructor(id: number) {
    delete this.hint;
    handOver(this);
    this.id = id;
  }
}
const log: string[] = [];
function hintOfFull(object: Full) {
  return object.hint;
}
function hintOfEmpty(object: Empty) {
  return object.hint;
}
function hintOfDeep(object: Deep) {
  return object.hint;
}
function setOnDeep(object: Deep, value: string) {
  object.hint = value;
}
function aroundTheLink(object: Full, above: object) {
  const before = object.hint;
  Object.setPrototypeOf(Object.getPrototypeOf(object), above);
  return `${before} ${object.hint}`;
}
function aroundTheStore(object: Empty, above: any, name: string) {
  const before = object.hint;
  above[name] = "came later";
  return `${before} ${object.hint}`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const deep = new Deep(i);
  length += (hintOfFull(new Full(i)) ?? "-").length + (hintOfEmpty(new Empty(i)) ?? "-").length + (hintOfDeep(deep) ?? "-").length;
  if (i & 1) setOnDeep(deep, "own");
  length += (hintOfDeep(deep) ?? "-").length;
}
console.log("warm", length);

const full = new Full(1);
console.log("an object that has the name:", aroundTheLink(full, { hint: "was there" }), "|", hintOfFull(new Full(2)), "hint" in full, Object.keys(full).join());

const between: object = {};
const empty = new Empty(1);
Object.setPrototypeOf(Empty.prototype, between);
console.log("an empty object:", hintOfEmpty(empty), hintOfEmpty(new Empty(2)));
console.log("it gets the name:", aroundTheStore(empty, between, "hint"), "|", hintOfEmpty(new Empty(3)), "hint" in empty);
delete (between as any).hint;
console.log("it loses the name:", hintOfEmpty(empty), hintOfEmpty(new Empty(4)), "hint" in empty);

const top: object = {};
const middle: object = Object.create(top);
const deep = new Deep(1);
Object.setPrototypeOf(Deep.prototype, middle);
console.log("two objects:", hintOfDeep(deep));
Object.defineProperty(top, "hint", {
  get() {
    return "from the top";
  },
  set(this: Deep, value: string) {
    log.push(`set ${value} on ${this.id}`);
  },
  configurable: true,
});
console.log("the upper one gets accessors:", hintOfDeep(deep), hintOfDeep(new Deep(2)));
setOnDeep(deep, "x");
setOnDeep(new Deep(3), "y");
console.log("stores:", hintOfDeep(deep), Object.keys(deep).join(), log.join(", "));
Object.setPrototypeOf(Deep.prototype, Object.prototype);
console.log("the link is put back:", hintOfDeep(deep), hintOfDeep(new Deep(4)));
setOnDeep(deep, "z");
console.log("stores:", hintOfDeep(deep), Object.keys(deep).join(), log.length);

// Text that is made at run time reads properties that compiled objects got behind their construction, at places that have run often:
// from objects whose properties came in another order, in other numbers, were deleted, redefined, shadowed, or never came.
function Holder(def) {
  this.def = def;
  this.traits = 1;
}
function Other(def) {
  this.traits = 2;
  this.def = def;
  this.more = 3;
}
function make(Constructor, names) {
  const holder = new Constructor(names.join("+"));
  for (const name of names) holder[name] = name + "#" + names.length;
  return holder;
}
const lines = [];
function show(label, f) {
  try {
    lines.push(label + ": " + String(f()));
  } catch (error) {
    lines.push(label + ": throws " + error.constructor.name);
  }
}
function reader(text) {
  return new Function("object", text);
}
const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "run", "check"];
const kinds = {
  runThenCheck: () => make(Holder, ["run", "check"]),
  checkThenRun: () => make(Holder, ["check", "run"]),
  onlyRun: () => make(Holder, ["run"]),
  onlyCheck: () => make(Holder, ["check"]),
  nothing: () => make(Holder, []),
  many: () => make(Holder, many),
  manyBackwards: () => make(Holder, many.toReversed()),
  otherLayout: () => make(Other, ["run", "check"]),
  ordinary: () => ({ def: "ordinary", run: "run of an ordinary object", check: "check of an ordinary object" }),
  withoutPrototype: () => Object.assign(Object.create(null), { run: "bare" }),
  inherits: () => Object.create(make(Holder, ["run", "check"])),
  string: () => "text",
  number: () => 7,
  undefined: () => undefined,
  null: () => null,
};
const texts = {
  run: "return object.run",
  all: "return object.run + '|' + object.check + '|' + object.def + '|' + object.traits",
  twice: "const first = object.run; const second = object.run; return first === second",
  last: "return object.l + '|' + object.a",
};
for (const warmWith of ["runThenCheck", "many", "otherLayout", "ordinary", "nothing"]) {
  for (const [name, text] of Object.entries(texts)) {
    const read = reader(text);
    const warm = kinds[warmWith]();
    for (let i = 0; i < 300; i++) read(warm);
    for (const [kind, create] of Object.entries(kinds)) show(`${warmWith} ${name} ${kind}`, () => read(create()));
    show(`${warmWith} ${name} again`, () => read(warm));
  }
}

const changes = {
  deleted(object) { delete object.run; },
  deletedAndStoredAgain(object) { delete object.run; object.run = "again"; },
  otherDeleted(object) { delete object.check; },
  stored(object) { object.run = "stored"; },
  storedUndefined(object) { object.run = undefined; },
  getter(object) { Object.defineProperty(object, "run", { get() { return "getter of " + this.def; }, configurable: true }); },
  getterThenValue(object) {
    Object.defineProperty(object, "run", { get() { return "getter"; }, configurable: true });
    Object.defineProperty(object, "run", { value: "value again", writable: true, configurable: true, enumerable: true });
  },
  readOnly(object) { Object.defineProperty(object, "run", { value: "read only", writable: false }); },
  hidden(object) { Object.defineProperty(object, "run", { enumerable: false }); },
  frozen(object) { Object.freeze(object); },
  sealed(object) { Object.seal(object); },
  moreProperties(object) { for (let i = 0; i < 40; i++) object["p" + i] = i; },
  otherPrototype(object) { Object.setPrototypeOf(object, { run: "of the new prototype", extra: 1 }); },
  otherPrototypeAndDeleted(object) { Object.setPrototypeOf(object, { run: "of the new prototype" }); delete object.run; },
  fieldDeleted(object) { delete object.def; },
  elements(object) { object[0] = "element"; object[5] = "another"; },
};
for (const [change, apply] of Object.entries(changes)) {
  for (const kind of ["runThenCheck", "many", "otherLayout"]) {
    const read = reader(texts.all);
    const object = kinds[kind]();
    const untouched = kinds[kind]();
    for (let i = 0; i < 300; i++) read(object);
    apply(object);
    show(`${change} ${kind}`, () => read(object));
    show(`${change} ${kind} untouched`, () => read(untouched));
    show(`${change} ${kind} keys`, () => Object.keys(object).length);
    for (let i = 0; i < 300; i++) read(object);
    show(`${change} ${kind} warm again`, () => read(object));
  }
}

// What lies in a compiled object ABOVE an ordinary receiver: values of every kind, methods, getters; and what happens to the holder, to the receiver and to the chain behind a warm place.
function makeHolder() {
  return {
    whole: 5, fraction: 1.5, truth: true, text: "text", nothing: null, missing: undefined, big: 2 ** 40, list: [1, 2], inner: { a: 1 },
    method() { return "method of " + typeof this; },
    arrow: () => "arrow",
    get got() { return "got by " + (this === undefined ? "nothing" : Object.keys(this).length); },
  };
}
const namesAbove = ["whole", "fraction", "truth", "text", "nothing", "missing", "big", "list", "inner", "method", "arrow", "got", "absent"];
const changesAbove = {
  none() {},
  storedInHolder(holder, receiver, name) { holder[name] = "stored in the holder"; },
  otherKindInHolder(holder, receiver, name) { holder[name] = typeof holder[name] === "number" ? "no number now" : 77; },
  deletedInHolder(holder, receiver, name) { delete holder[name]; },
  getterInHolder(holder, receiver, name) { Object.defineProperty(holder, name, { get() { return "new getter"; }, configurable: true }); },
  ownInReceiver(holder, receiver, name) { receiver[name] = "own"; },
  ownThenDeleted(holder, receiver, name) { receiver[name] = "own"; delete receiver[name]; },
  receiverGetsOtherPrototype(holder, receiver) { Object.setPrototypeOf(receiver, { whole: "elsewhere", method: "elsewhere" }); },
  holderGetsOtherPrototype(holder) { Object.setPrototypeOf(holder, { absent: "now above the holder" }); },
  holderFrozen(holder) { Object.freeze(holder); },
  holderGetsMore(holder) { for (let i = 0; i < 30; i++) holder["more" + i] = i; },
};
for (const [change, apply] of Object.entries(changesAbove)) {
  for (const depth of [1, 2]) {
    for (const name of namesAbove) {
      const read = reader("const value = object." + name + "; return typeof value === 'function' ? value.call(object) : typeof value === 'object' && value ? JSON.stringify(value) : value");
      const holder = makeHolder();
      const receiver = depth === 1 ? Object.create(holder) : Object.create(Object.create(holder));
      for (let i = 0; i < 300; i++) read(receiver);
      const before = String(read(receiver));
      show(`above ${change} ${depth} ${name} changes`, () => apply(holder, receiver, name));
      show(`above ${change} ${depth} ${name}`, () => before + " > " + String(read(receiver)));
      for (let i = 0; i < 300; i++) read(receiver);
      show(`above ${change} ${depth} ${name} warm again`, () => read(receiver));
    }
  }
}

// One place, objects in turn.
const inTurn = reader(texts.all);
const turn = Object.values(kinds).slice(0, 10).map(create => create());
let sum = 0;
for (let i = 0; i < 3000; i++) sum += inTurn(turn[i % turn.length]).length;
lines.push("in turn: " + sum);

// The objects of a place die, and others of the same making come.
const afterCollections = reader(texts.all);
for (let round = 0; round < 4; round++) {
  let object = make(Holder, ["run", "round" + round, "check"]);
  for (let i = 0; i < 300; i++) afterCollections(object);
  show("round " + round, () => afterCollections(object));
  object = null;
  if (typeof Bun !== "undefined") Bun.gc(true);
}
console.log(lines.join("\n"));

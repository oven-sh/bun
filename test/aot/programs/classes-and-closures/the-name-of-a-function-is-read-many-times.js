// A function object that nobody has written to answers `name` and `length` out of the record of its function, however often it is asked. What is asked in between sees ordinary properties.
const unseen = new Function("x", "return x");
const lines = [];
const symbol = Symbol("described");
const holder = {
  method() {}, get got() { return 1; }, set got(value) {}, async waits() {}, *yields() {}, async *both() {}, [symbol]() {}, ["comp" + unseen("uted")]() {}, 7() {}, arrow: () => {}, expression: function () {}, named: function inner() {},
};
class Made { static fixed() {} own() {} static get read() { return 1; } #hidden() {} hiddenOne() { return this.#hidden; } static field = () => {}; }
function declared(a, b) {}
const kinds = {
  declared,
  anonymousArrow: (() => () => {})(),
  anonymousFunction: (function () { return function () {}; })(),
  assignedArrow: (() => { const assigned = () => {}; unseen(assigned); return assigned; })(),
  defaulted: (({ byDefault = () => {} } = {}) => byDefault)(),
  method: holder.method,
  getter: Object.getOwnPropertyDescriptor(holder, "got").get,
  setter: Object.getOwnPropertyDescriptor(holder, "got").set,
  asyncMethod: holder.waits,
  generator: holder.yields,
  asyncGenerator: holder.both,
  symbolKey: holder[symbol],
  computedKey: holder.computed,
  indexKey: holder[7],
  arrowInLiteral: holder.arrow,
  expressionInLiteral: holder.expression,
  namedExpression: holder.named,
  classObject: Made,
  staticMethod: Made.fixed,
  prototypeMethod: Made.prototype.own,
  staticGetter: Object.getOwnPropertyDescriptor(Made, "read").get,
  privateMethod: new Made().hiddenOne(),
  staticField: Made.field,
  bound: declared.bind(null, 1),
  boundTwice: declared.bind(null).bind(null),
  boundArrow: (() => {}).bind(null),
  capturing: (value => () => value)(3),
};
function readName(target) { return target.name; }
function readLength(target) { return target.length; }
for (const [label, made] of Object.entries(kinds)) {
  const target = unseen(made);
  const names = [];
  for (let round = 0; round < 24; round++) names.push(readName(target));
  const lengths = [];
  for (let round = 0; round < 24; round++) lengths.push(readLength(target));
  lines.push(label + ": " + JSON.stringify(names[0]) + " " + new Set(names).size + " " + typeof names[23] + " | " + lengths[0] + " " + new Set(lengths).size);
  lines.push("  has " + Object.hasOwn(target, "name") + " " + ("name" in target) + " " + target.hasOwnProperty("length") + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(target, "name")) + " | " + Reflect.ownKeys(target).map(String).join());
  lines.push("  again " + JSON.stringify(readName(target)) + " " + readLength(target) + " " + JSON.stringify(target["na" + unseen("me")]));
  // A store to a read-only property changes nothing, and throws in strict code.
  lines.push("  set " + Reflect.set(target, "name", "stored") + " " + JSON.stringify(readName(target)));
  try { target.name = "stored"; lines.push("  stored"); } catch (error) { lines.push("  " + error.constructor.name + " " + JSON.stringify(readName(target))); }
  Object.defineProperty(target, "name", { value: "defined " + label });
  lines.push("  defined " + JSON.stringify(readName(target)) + " " + JSON.stringify(readName(target)));
  lines.push("  deleted " + delete target.name + " " + JSON.stringify(readName(target)) + " " + Object.hasOwn(target, "name") + " " + Reflect.ownKeys(target).map(String).join());
  Object.defineProperty(target, "name", { get() { return "got " + label; }, configurable: true });
  lines.push("  getter " + JSON.stringify(readName(target)) + " " + JSON.stringify(readName(target)));
}
// Many function objects of one function: what one of them gets, the others do not have.
const many = [];
for (let index = 0; index < 40; index++) many.push(unseen(function shared() { return index; }));
for (const one of many) readName(one), readName(one), readName(one);
Object.defineProperty(many[7], "name", { value: "seventh" });
delete many[9].name;
many[11].extra = 1;
lines.push(many.map(readName).join());
lines.push(many.map(one => Reflect.ownKeys(one).join("+")).filter((keys, index, all) => all.indexOf(keys) === index).join(" | "));
console.log(lines.join("\n"));

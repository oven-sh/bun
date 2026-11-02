// One class text evaluated many times with and without parents.
const unseen = new Function("x", "return x");
const lines = [];
const describe = (label, Made) => {
  const prototype = Made.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(Made, "prototype");
  const back = Object.getOwnPropertyDescriptor(prototype, "constructor");
  lines.push([
    label,
    Reflect.ownKeys(Made).map(String).sort().join(),
    Reflect.ownKeys(prototype).map(String).join(),
    descriptor.writable + "" + descriptor.enumerable + descriptor.configurable,
    back.writable + "" + back.enumerable + back.configurable,
    back.value === Made,
    Made.name,
    Made.length,
  ].join(" | "));
};

// No parent, no members.
function bare() { return class Bare {}; }
const bares = [];
for (let index = 0; index < 6; index++) bares.push(bare());
bares.forEach((Made, index) => describe("bare " + index, Made));
lines.push("bare: all different " + (new Set(bares).size === 6) + " " + (new Set(bares.map(Made => Made.prototype)).size === 6));
lines.push("bare: parents " + bares.every(Made => Object.getPrototypeOf(Made) === Function.prototype && Object.getPrototypeOf(Made.prototype) === Object.prototype));
lines.push("bare: instances " + bares.map((Made, index) => new Made() instanceof bares[(index + 1) % 6]).join() + " " + bares.every(Made => new Made() instanceof Made));

// What one evaluation gets is not seen on the next.
bares[1].prototype.added = 1;
bares[2].extra = 2;
Object.defineProperty(bares[3], "name", { value: "Renamed" });
Object.setPrototypeOf(bares[4].prototype, { from: "elsewhere" });
Object.freeze(bares[5]);
const later = [bare(), bare()];
later.forEach((Made, index) => describe("bare later " + index, Made));
lines.push("bare later: " + [new later[0]().added, later[0].extra, later[1].name, new later[1]().from, Object.isFrozen(later[1]), Object.isExtensible(later[0].prototype)].join());
bares.forEach((Made, index) => describe("bare again " + index, Made));

// A parent that is a parameter: the same one, another one, a function, a built-in class, null.
function below(Parent) { return class Below extends Parent {}; }
class First { who() { return "first"; } static where() { return "on First"; } }
class Second { who() { return "second"; } static where() { return "on Second"; } }
function Old() { this.old = true; }
Old.prototype.who = function () { return "old"; };
const parents = [First, First, Second, First, Old, Object, Map, Second, Old, Error, First];
const belows = parents.map(Parent => below(unseen(Parent)));
belows.forEach((Made, index) => {
  describe("below " + index, Made);
  const made = new Made();
  lines.push("below " + index + ": " + [Object.getPrototypeOf(Made) === parents[index], Object.getPrototypeOf(Made.prototype) === parents[index].prototype, typeof made.who === "function" ? made.who() : typeof made.who, typeof Made.where === "function" ? Made.where() : typeof Made.where, made instanceof parents[index], made.old].join());
});
const Nothing = [below(null), below(null)];
Nothing.forEach((Made, index) => {
  describe("below null " + index, Made);
  lines.push("below null " + index + ": " + [Object.getPrototypeOf(Made) === Function.prototype, Object.getPrototypeOf(Made.prototype)].join());
  try { new Made(); lines.push("constructed"); } catch (error) { lines.push(error.constructor.name); }
});
for (const bad of [1, "text", undefined, {}, () => 1, Symbol.iterator]) {
  try { below(bad); lines.push("made below " + String(bad)); } catch (error) { lines.push("below " + typeof bad + ": " + error.constructor.name); }
}
function NoObject() {}
NoObject.prototype = 5;
try { below(NoObject); lines.push("made"); } catch (error) { lines.push("prototype is a number: " + error.constructor.name); }
NoObject.prototype = null;
const BelowNullPrototype = below(NoObject);
lines.push("prototype is null: " + [Object.getPrototypeOf(BelowNullPrototype) === NoObject, Object.getPrototypeOf(BelowNullPrototype.prototype)].join());

// The parent's prototype property changes between two evaluations.
function Moving() {}
Moving.prototype.who = function () { return "before"; };
const BelowBefore = below(Moving);
Moving.prototype = { who() { return "after"; } };
const BelowAfter = below(Moving);
const BelowAfterAgain = below(Moving);
lines.push("moving: " + [new BelowBefore().who(), new BelowAfter().who(), new BelowAfterAgain().who(), Object.getPrototypeOf(BelowAfter.prototype) === Object.getPrototypeOf(BelowAfterAgain.prototype), BelowAfter.prototype === BelowAfterAgain.prototype].join());

// The way a validation library makes its kinds: the class, then properties defined on it.
function kind(name, initializer, Parent) {
  class Definition extends (Parent ?? Object) {}
  Object.defineProperty(Definition, "name", { value: name });
  function Kind(value) {
    const made = Parent ? new Definition() : this;
    initializer(made, value);
    return made;
  }
  Object.defineProperty(Kind, "init", { value: initializer });
  Object.defineProperty(Kind, Symbol.hasInstance, { value: made => Parent && made instanceof Parent ? true : made?.marks?.has(name) });
  Object.defineProperty(Kind, "name", { value: name });
  return [Kind, Definition];
}
const kinds = [];
for (const name of ["one", "two", "three", "four", "five"])
  kinds.push(kind(name, (made, value) => { (made.marks ??= new Set()).add(name); made.value = value; }, name === "three" ? Error : name === "five" ? First : undefined));
kinds.forEach(([Kind, Definition]) => {
  const made = new Kind(Kind.name.length);
  describe("kind " + Kind.name, Definition);
  lines.push("kind " + [Kind.name, Definition.name, made.value, made instanceof Kind, made instanceof kinds[0][0], made instanceof Definition, Object.getPrototypeOf(Definition) === Object, typeof made.who].join());
});

console.log(lines.join("\n"));

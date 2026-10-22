// A symbol that a function returns is kept in an array, a Map, a Set, a WeakMap, a field, a static field and a wrapper; registered and well-known symbols beside it.
function show(label, value) {
  console.log(label, typeof value === "symbol" ? String(value) : value);
}

function makeForArray() { return Symbol("array"); }
const list = [makeForArray()];
show("array", list[0]);
show("array includes", list.includes(list[0]));
show("array index", list.indexOf(list[0]));

function makeForMap() { return Symbol("map"); }
const mapKey = makeForMap();
const map = new Map([[mapKey, "value"]]);
show("map get", map.get(mapKey));
show("map key", [...map.keys()][0] === mapKey);
show("map other", map.get(Symbol("map")));

function makeForSet() { return Symbol("set"); }
const setMember = makeForSet();
show("set has", new Set([setMember]).has(setMember));

function makeForField() { return Symbol("field"); }
class Pet {
  mark = makeForField();
}
const pet = new Pet();
show("field", pet.mark);
show("field legs", pet.mark.legs);

function makeForStatic() { return Symbol("static"); }
class Kennel {
  static mark = makeForStatic();
}
Kennel.prototype[Kennel.mark] = function () { return "called"; };
show("static", Kennel.mark);
show("static method", new Kennel()[Kennel.mark]());

function makeForWrapper() { return Symbol("wrapper"); }
const wrapped = Object(makeForWrapper());
show("wrapper typeof", typeof wrapped);
show("wrapper text", wrapped.toString());
show("wrapper description", wrapped.description);
show("wrapper value", typeof wrapped.valueOf());
show("wrapper instance", wrapped instanceof Symbol);

function makeRegistered() { return Symbol.for("registered"); }
const registered = makeRegistered();
show("registered", registered === Symbol.for("registered"));
show("registered key", Symbol.keyFor(registered));
const holdsRegistered = {};
Object.defineProperty(holdsRegistered, "pet", { value: makeRegistered(), writable: true, enumerable: true, configurable: true });
show("registered defined", holdsRegistered.pet === registered);
show("registered legs", holdsRegistered.pet.legs);

function makeWellKnown() { return Symbol.iterator; }
const holdsWellKnown = {};
Object.defineProperty(holdsWellKnown, "pet", { value: makeWellKnown(), writable: true, enumerable: true, configurable: true });
show("well-known defined", holdsWellKnown.pet === Symbol.iterator);
show("well-known legs", holdsWellKnown.pet.legs);
show("well-known key", Symbol.keyFor(holdsWellKnown.pet));

function makeUnregistered() { return Symbol("unregistered"); }
show("unregistered key", Symbol.keyFor(makeUnregistered()));

function makeForWeakMap() { return Symbol("weak"); }
const weakKey = makeForWeakMap();
const weak = new WeakMap([[weakKey, "kept"]]);
show("weak", weak.get(weakKey));

function makeForJSON() { return Symbol("json"); }
show("json", JSON.stringify({ a: makeForJSON(), b: 1 }));

function makeForText() { return Symbol("text"); }
try {
  show("concatenated", "" + makeForText());
} catch (error) {
  show("concatenated throws", error instanceof TypeError);
}

function makeForNumber() { return Symbol("number"); }
try {
  show("number", +makeForNumber());
} catch (error) {
  show("number throws", error instanceof TypeError);
}

// A property that the layout of its object does not have is redefined: from every state, by every descriptor, written out as a literal so that no descriptor object is made.
const lines = [];
const getA = function getA() { return "a"; }, getB = function getB() { return "b"; };
const setA = function setA(v) {}, setB = function setB(v) {};
function describe(object, key) {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d) return "none";
  return ("value" in d ? "v=" + String(d.value) + (d.writable ? "W" : "w") : "g=" + (d.get ? d.get.name : "-") + " s=" + (d.set ? d.set.name : "-")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c");
}
const states = [];
for (const writable of [true, false]) for (const enumerable of [true, false]) for (const configurable of [true, false])
  states.push(["data" + +writable + +enumerable + +configurable, (o, k) => Object.defineProperty(o, k, { value: 1, writable, enumerable, configurable })]);
for (const [name, get, set] of [["gs", getA, setA], ["g", getA, undefined], ["s", undefined, setA], ["none", undefined, undefined]]) for (const enumerable of [true, false]) for (const configurable of [true, false])
  states.push(["accessor-" + name + +enumerable + +configurable, (o, k) => Object.defineProperty(o, k, { get, set, enumerable, configurable })]);
states.push(["stored", (o, k) => { o[k] = 1; }]);
const redefinitions = [
  ["{}", (o, k) => Object.defineProperty(o, k, {})],
  ["v", (o, k) => Object.defineProperty(o, k, { value: 2 })],
  ["v-same", (o, k) => Object.defineProperty(o, k, { value: 1 })],
  ["v-undefined", (o, k) => Object.defineProperty(o, k, { value: undefined })],
  ["W", (o, k) => Object.defineProperty(o, k, { writable: true })],
  ["w", (o, k) => Object.defineProperty(o, k, { writable: false })],
  ["E", (o, k) => Object.defineProperty(o, k, { enumerable: true })],
  ["e", (o, k) => Object.defineProperty(o, k, { enumerable: false })],
  ["C", (o, k) => Object.defineProperty(o, k, { configurable: true })],
  ["c", (o, k) => Object.defineProperty(o, k, { configurable: false })],
  ["vW", (o, k) => Object.defineProperty(o, k, { value: 2, writable: true })],
  ["vw", (o, k) => Object.defineProperty(o, k, { value: 2, writable: false })],
  ["vWEC", (o, k) => Object.defineProperty(o, k, { value: 2, writable: true, enumerable: true, configurable: true })],
  ["vwec", (o, k) => Object.defineProperty(o, k, { value: 2, writable: false, enumerable: false, configurable: false })],
  ["vWC", (o, k) => Object.defineProperty(o, k, { value: 2, writable: true, configurable: true })],
  ["vE", (o, k) => Object.defineProperty(o, k, { value: 2, enumerable: true })],
  ["ec", (o, k) => Object.defineProperty(o, k, { enumerable: false, configurable: false })],
  ["g", (o, k) => Object.defineProperty(o, k, { get: getB })],
  ["s", (o, k) => Object.defineProperty(o, k, { set: setB })],
  ["gs", (o, k) => Object.defineProperty(o, k, { get: getB, set: setB })],
  ["g-undefined", (o, k) => Object.defineProperty(o, k, { get: undefined })],
  ["s-undefined", (o, k) => Object.defineProperty(o, k, { set: undefined })],
  ["g-same", (o, k) => Object.defineProperty(o, k, { get: getA })],
  ["gE", (o, k) => Object.defineProperty(o, k, { get: getB, enumerable: true })],
  ["gC", (o, k) => Object.defineProperty(o, k, { get: getB, configurable: true })],
  ["gsec", (o, k) => Object.defineProperty(o, k, { get: getB, set: setB, enumerable: false, configurable: false })],
  ["gsEC", (o, k) => Object.defineProperty(o, k, { get: getB, set: setB, enumerable: true, configurable: true })],
];
function make() { return { first: 1, second: 2 }; }
let number = 0;
for (const [stateName, prepare] of states) {
  for (const [name, redefine] of redefinitions) {
    for (const surroundings of [0, 1]) {
      const object = make();
      const key = "extra" + (number++ % 5);
      if (surroundings) object.before = 0;
      prepare(object, key);
      if (surroundings) object.after = 0;
      let outcome;
      try { outcome = redefine(object, key) === object ? "ok" : "other"; } catch (error) { outcome = error.constructor.name + ": " + error.message; }
      lines.push(stateName + " " + name + " " + surroundings + " > " + outcome + " | " + describe(object, key) + " | " + Reflect.ownKeys(object).join() + " | " + Object.keys(object).join() + " | " + JSON.stringify(object));
    }
  }
}
const sealed = make(); sealed.x = 1; Object.preventExtensions(sealed);
Object.defineProperty(sealed, "x", { get: getB }); lines.push("not extensible " + describe(sealed, "x"));
const above = make(); above.shared = 1; const below = Object.create(above);
lines.push("chain " + below.shared); Object.defineProperty(above, "shared", { get: getB, configurable: true }); lines.push("chain " + below.shared);
below.shared = 5; lines.push("chain " + Object.keys(below).length); Object.defineProperty(above, "shared", { value: 3, writable: true }); below.shared = 6; lines.push("chain " + Object.keys(below).join() + below.shared);
function read(o) { return o.lazy; }
const lazy = make();
Object.defineProperty(lazy, "lazy", { get() { Object.defineProperty(this, "lazy", { value: "made" }); return "first"; }, configurable: true });
for (let i = 0; i < 4; i++) lines.push("lazy " + read(lazy) + " " + describe(lazy, "lazy"));
console.log(lines.join("\n"));

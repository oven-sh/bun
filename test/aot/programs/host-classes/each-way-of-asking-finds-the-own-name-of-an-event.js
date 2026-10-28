// `isTrusted` is an own property of every event. Each function here has no types and is handed events alone, so what it answers follows from what the compiler knows of an event.
function byName(event) {
  return event.isTrusted;
}
function byKey(event, key) {
  return event[key];
}
function byPattern(event) {
  const { isTrusted } = event;
  return isTrusted;
}
function byReflection(event) {
  return Reflect.get(event, "isTrusted");
}
function firstValue(event) {
  return Object.values(event)[0];
}
function ofSpread(event) {
  return { ...event }.isTrusted;
}
function ofAssigned(event) {
  return Object.assign({}, event).isTrusted;
}
function ofDescriptor(event) {
  return Object.getOwnPropertyDescriptor(event, "isTrusted")?.enumerable;
}
function calledOn(event) {
  return event.isTrusted.toString();
}
console.log(byName(new Event("a")) ?? "nullish", byName(new Event("b")) === undefined, typeof byName(new Event("c")));
console.log(byKey(new Event("a"), ["is", "Trusted"].join("")) ?? "nullish", byPattern(new Event("a")) ?? "nullish");
console.log(byReflection(new Event("a")) ?? "nullish", firstValue(new Event("a")) ?? "nullish");
console.log(ofSpread(new Event("a")) ?? "nullish", ofAssigned(new Event("a")) ?? "nullish");
console.log(ofDescriptor(new Event("a")) ?? "nullish", calledOn(new Event("a")));

class Below extends Event {}
class Deeper extends Below {
  constructor() {
    super("d");
    this.own = 2;
  }
}
function ofClassBelow(event) {
  return event.isTrusted;
}
function ownOfClassBelow(event) {
  return event.own;
}
function missingOfClassBelow(event) {
  return event.nothingOfTheKind;
}
console.log(ofClassBelow(new Deeper()) ?? "nullish", ownOfClassBelow(new Deeper()), missingOfClassBelow(new Deeper()));

function Other() {}
function forAnotherTarget(event) {
  return event.isTrusted;
}
console.log(forAnotherTarget(Reflect.construct(Event, ["x"], Other)) ?? "nullish");

function amongMany(object) {
  return object.isTrusted;
}
const many = [{ a: 1 }, { b: 1 }, { c: 1 }, { d: 1 }, { e: 1 }, { f: 1 }, { g: 1 }, { h: 1 }, { i: 1 }, { j: 1 }];
many.push(new Event("y"));
let text = "";
for (let index = 0; index < many.length; index++) text += (amongMany(many[index]) ?? "nullish") + " ";
console.log(text);

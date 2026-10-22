const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  return String(value);
}

function describe(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return show(value);
  return (
    "{" +
    Reflect.ownKeys(value)
      .map(key => {
        const found = Reflect.getOwnPropertyDescriptor(value, key);
        return String(key) + ("value" in found ? "=" + show(found.value) : " accessor");
      })
      .join(", ") +
    "}"
  );
}

console.log("strict code:", (function () { return this === undefined; })());

function Ticket(seat, price) {
  this.seat = seat;
  this.price = price;
  this.seenThis = typeof this;
}
Ticket.prototype.total = function () {
  return this.price + 1;
};

function fillWithCall(target) {
  return Ticket.call(target, "A1", 20);
}

function fillWithApply(target) {
  return Ticket.apply(target, ["A1", 20]);
}

function fillWithBind(target) {
  return Ticket.bind(target, "A1")(20);
}

function fillWithReflect(target) {
  return Reflect.apply(Ticket, target, ["A1", 20]);
}

const ways = [
  ["call", fillWithCall],
  ["apply", fillWithApply],
  ["bind", fillWithBind],
  ["Reflect.apply", fillWithReflect],
];

const targets = [
  ["an instance", () => new Ticket("Z9", 1)],
  ["an object made from the prototype", () => Object.create(Ticket.prototype)],
  ["an empty literal", () => ({})],
  ["a literal with the fields in another order", () => ({ price: 0, seat: "" })],
  ["an array", () => []],
  ["a function", () => function target() {}],
  ["an object without a prototype", () => Object.create(null)],
  ["a frozen literal", () => Object.freeze({ seat: "frozen" })],
  ["a sealed literal", () => Object.seal({ seat: "sealed" })],
  ["a frozen instance", () => Object.freeze(new Ticket("Z9", 1))],
  ["a literal whose seat cannot be written", () => Object.defineProperty({}, "seat", { value: "fixed", enumerable: true })],
  ["a literal with a setter for price", () => ({ set price(value) { log.push("set price " + value); } })],
  ["a literal with only a getter for price", () => ({ get price() { return "got"; } })],
  ["a proxy that logs stores", () => new Proxy({}, { set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); }, defineProperty(target, key, found) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, found); } })],
  ["a number", () => 5],
  ["a string", () => "text"],
  ["a boolean", () => false],
  ["a symbol", () => Symbol.for("target")],
  ["a bigint", () => 5n],
];

let sum = 0;
for (let i = 0; i < 2000; i++) sum += new Ticket("B" + (i % 5), i % 9).total();
console.log("2000 honest constructions", sum);

for (const [targetLabel, makeTarget] of targets) {
  for (const [wayLabel, fill] of ways) {
    const target = makeTarget();
    let line = targetLabel + ", " + wayLabel + " -> ";
    try {
      line += show(fill(target));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | log " + log.splice(0).join(", ") + " | now " + describe(target));
  }
}

for (const [wayLabel, fill] of ways) {
  for (const [targetLabel, target] of [["undefined", undefined], ["null", null]]) {
    let line = targetLabel + ", " + wayLabel + " -> ";
    try {
      line += show(fill(target));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | the global object has seat: " + ("seat" in globalThis) + ", seenThis: " + show(globalThis.seenThis));
    delete globalThis.seat;
    delete globalThis.price;
    delete globalThis.seenThis;
  }
}

console.log("honest again", describe(new Ticket("C3", 30)), new Ticket("C3", 30).total());

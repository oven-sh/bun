// In a CommonJS module, where a function is sloppy unless it says otherwise. The getter is found above the receiver. `this` is the receiver: an heir, an heir of an heir, a primitive in strict and in sloppy code, what Reflect.get names.
function strictGetter() { "use strict"; return typeof this + "|" + (this === null ? "null" : Object(this) === this ? this.tag : String(this)); }
function sloppyGetter() { return typeof this + "|" + (this.tag ?? String(this.valueOf())); }
function holderWith(getter) {
  const holder = Object.create(null);
  Object.defineProperty(holder, "seen", { get: getter, configurable: true });
  holder.tag = "holder";
  return holder;
}
function read(value) { return value.seen; }
const log = [];
for (const getter of [strictGetter, sloppyGetter]) {
  const holder = holderWith(getter);
  const heir = Object.create(holder); heir.tag = "heir";
  const heirOfHeir = Object.create(heir); heirOfHeir.tag = "heir of heir";
  for (let round = 0; round < 30; round++) { read(holder); read(heir); read(heirOfHeir); }
  log.push(read(holder), read(heir), read(heirOfHeir));
  log.push(Reflect.get(holder, "seen", heirOfHeir), Reflect.get(heir, "seen", 5), Reflect.get(heir, "seen", { tag: "named" }));
  const prototypes = [String.prototype, Number.prototype, Boolean.prototype, Symbol.prototype, BigInt.prototype];
  for (const prototype of prototypes) Object.defineProperty(prototype, "seen", { get: getter, configurable: true });
  for (let round = 0; round < 30; round++) { read("text"); read(5); }
  log.push(read("text"), read(5), read(1.5), read(true), read(10n), read(Symbol.iterator));
  for (const prototype of prototypes) delete prototype.seen;
  log.push(String(read("text")), String(read(5)));
}
for (const nothing of [undefined, null]) {
  try { read(nothing); } catch (error) { log.push(error.constructor.name + " " + error.message.replace(/ \(evaluating.*/, "")); }
}
console.log(log.join("\n"));
/* Output:
object|holder
object|heir
object|heir of heir
object|heir of heir
number|5
object|named
string|text
number|5
number|1.5
boolean|true
bigint|10
symbol|Symbol(Symbol.iterator)
undefined
undefined
object|holder
object|heir
object|heir of heir
object|heir of heir
object|5
object|named
object|text
object|5
object|1.5
object|true
object|10
object|Symbol(Symbol.iterator)
undefined
undefined
TypeError undefined is not an object
TypeError null is not an object
*/

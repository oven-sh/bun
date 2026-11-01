// Classes of evaluated text stamp private methods on objects of compiled classes, and stand below compiled classes.
class Bag extends Map<string, number> { room(): number { return 3 - this.size; } }
class Plain { size = 7; room(): number { return -7; } }
function roomOf(value: Bag | Plain): number { return value.room(); }
function sizeOf(value: Bag | Plain): number { return value.size; }
function onlyBag(value: Bag): number { return value.room() + value.size; }
const Stamper = (0, eval)("(class Stamper extends (function (o) { return o; }) { #mark() { return 1; } static has(o) { return #mark in o; } static call(o) { return o.#mark(); } })");
const Second = (0, eval)("(class Second extends (function (o) { return o; }) { #other() { return 2; } get #got() { return 3; } static has(o) { return #other in o; } static call(o) { return o.#other() + o.#got; } })");
const below = new Function("Bag", "return class Below extends Bag { #own() { return 5; } room() { return super.room() + this.#own(); } }")(Bag);
for (let round = 0; round < 4; round++) {
  const bag = new Bag([["a", 1]]);
  const lines = [roomOf(bag), sizeOf(bag), onlyBag(bag), Stamper.has(bag)];
  new Stamper(bag);
  lines.push(roomOf(bag), sizeOf(bag), onlyBag(bag), Stamper.has(bag), Stamper.call(bag), Second.has(bag));
  new Second(bag);
  lines.push(roomOf(bag), sizeOf(bag), onlyBag(bag), Second.has(bag), Second.call(bag), Stamper.call(bag));
  bag.set("b", 2); (bag as any).own = 1;
  lines.push(roomOf(bag), sizeOf(bag), onlyBag(bag), roomOf(new Plain()), sizeOf(new Plain()));
  const lower = new below([["x", 1]]);
  lines.push(roomOf(lower), sizeOf(lower), onlyBag(lower), lower instanceof Bag, Stamper.has(lower));
  new Stamper(lower);
  lines.push(roomOf(lower), onlyBag(lower), Stamper.call(lower));
  try { new Stamper(bag); } catch (error) { lines.push((error as Error).constructor.name); }
  console.log(lines.join(" "));
}

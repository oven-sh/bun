// Stores and reads of `area` and `size` on objects of two families of constructor functions whose prototypes both hold a method `area` and a getter `size`.
function show(value) {
  return String(value);
}

// The first family builds its objects with Reflect.construct.
function Square(a) { this.a = a; }
Square.prototype.area = function () { return this.a * 2; };
Object.defineProperty(Square.prototype, "size", { get() { return this.a + 0; }, configurable: true });
function Point(a) { this.a = a; }
function deriveByConstruct(Base, tag) {
  function Derived(a, b) { const made = Reflect.construct(Base, [a], new.target || Derived); made.tag = tag; made.b = b; return made; }
  Object.defineProperty(Derived.prototype, "size", { get() { return -this.a; }, configurable: true });
  Derived.prototype.twice = function () { return this.area() * 2; };
  return Derived;
}
const FromSquare = deriveByConstruct(Square, "first");
const FromPoint = deriveByConstruct(Point, "second");
function storeAndRead(turn) {
  const out = [];
  try {
    const Made = turn % 2 === 1 ? FromPoint : FromSquare;
    const o = new Made(turn, 2);
    if (turn % 3 === 1) o.area = undefined; out.push(typeof o.area + String(Object.hasOwn(o, "area")));
    if (turn % 5 === 3) o.size = undefined; out.push(show(o.size) + String(Object.hasOwn(o, "size")));
    if (turn % 3 === 1) o.area = undefined; out.push(typeof o.area + String(Object.hasOwn(o, "area")));
  } catch (e) {
    out.push("threw " + e.constructor.name);
  }
  return out.join(" ");
}
{
  for (let turn = 0; turn < 12; turn++) {
    const line = storeAndRead(turn);
    console.log(turn, line);
  }
}

// The second family links its prototype object below another with Object.setPrototypeOf.
function Disk(a) { this.a = a; }
Disk.prototype.area = function () { return this.a * 2; };
Object.defineProperty(Disk.prototype, "size", { get() { return this.a + 0; }, configurable: true });
function deriveByLink(Base, tag) {
  function Derived(a, b) { try { Base.call(this, a); } catch (e) { this.a = a; } this.tag = tag; this.b = b; }
  Object.setPrototypeOf(Derived.prototype, Base.prototype);
  return Derived;
}
const FromDisk = deriveByLink(Disk, "second");
// `lines` is declared nowhere, so the call throws before `size` is read.
function storeAndThrow(turn) {
  try {
    const Made = FromDisk;
    const o = new Made(turn, 2);
    if (turn % 5 === 3) o.size = undefined; lines.push(show(o.size) + String(Object.hasOwn(o, "size")));
  } catch (e) {
  }
}
{
  for (let turn = 0; turn < 40; turn++) {
    const line = storeAndThrow(turn);
  }
}

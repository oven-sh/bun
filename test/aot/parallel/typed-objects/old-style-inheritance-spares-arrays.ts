// Constructors chained with Object.setPrototypeOf, as transpiled classes, util.inherits and Babel's helpers chain them, and objects whose prototype is
// stored to: none of it concerns an index. The arrays of the program go on keeping their elements in place. `describe` is the jsc shell's.
const describe: ((value: unknown) => string) | undefined = (globalThis as any).describe;
function arraysAreSlow(): boolean { const made = [1, 2, 3]; made.push(4); return describe !== undefined && /SlowPut/.test(describe(made)); }
console.log("at the start", arraysAreSlow());

function f1() { return 1; }
function g1() { return 2; }
const h1 = Object.create(f1);
Object.setPrototypeOf(f1, g1);
console.log("created from it, then chained", typeof h1, f1(), g1(), arraysAreSlow());

function f2() { return 1; }
function g2() { return 2; }
Object.setPrototypeOf(f2, g2);
const h2 = Object.create(f2);
console.log("chained, then created from it", typeof h2, f2(), g2(), arraysAreSlow());

function Base(this: any) { this.a = 1; }
function Mid(this: any) { this.b = 2; }
function Leaf(this: any) { this.c = 3; }
Object.setPrototypeOf(Leaf, Mid);
Object.setPrototypeOf(Mid, Base);
console.log("three in a chain", Object.getPrototypeOf(Leaf) === Mid, Object.getPrototypeOf(Mid) === Base, arraysAreSlow());

let extendStatics = function (d: any, b: any): any {
  extendStatics = Object.setPrototypeOf || function (d: any, b: any) { for (const p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
  return extendStatics(d, b);
};
function __extends(d: any, b: any): void {
  extendStatics(d, b);
  function __(this: any) { this.constructor = d; }
  d.prototype = b === null ? Object.create(b) : (((__ as any).prototype = b.prototype), new (__ as any)());
}
const Animal: any = (function () { function Animal(this: any, name: string) { this.name = name; } Animal.prototype.speak = function () { return this.name + " speaks"; }; (Animal as any).kinds = 2; return Animal; })();
const Dog: any = (function (_super: any) { __extends(Dog, _super); function Dog(this: any, name: string) { return _super.call(this, name) || this; } Dog.prototype.fetch = function () { return this.name + " fetches"; }; return Dog; })(Animal);
const Puppy: any = (function (_super: any) { __extends(Puppy, _super); function Puppy(this: any) { return (_super !== null && _super.apply(this, arguments)) || this; } return Puppy; })(Dog);
const puppy = new Puppy("rex");
console.log("__extends", puppy.speak(), puppy.fetch(), Puppy.kinds, puppy instanceof Animal, arraysAreSlow());

function inherits(ctor: any, superCtor: any): void { Object.defineProperty(ctor, "super_", { value: superCtor, writable: true, configurable: true }); Object.setPrototypeOf(ctor.prototype, superCtor.prototype); }
function Emitter(this: any) { this.listeners = []; }
Emitter.prototype.on = function (this: any, listener: () => void) { this.listeners.push(listener); return this.listeners.length; };
function Stream(this: any) { (Emitter as any).call(this); }
inherits(Stream, Emitter);
function Socket(this: any) { (Stream as any).call(this); }
inherits(Socket, Stream);
console.log("util.inherits", new (Socket as any)().on(() => {}), (Socket as any).super_ === Stream, arraysAreSlow());

function _setPrototypeOf(o: any, p: any): any { return Object.setPrototypeOf(o, p); }
function _inherits(subClass: any, superClass: any): void {
  subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } });
  Object.defineProperty(subClass, "prototype", { writable: false });
  if (superClass) _setPrototypeOf(subClass, superClass);
}
function Shape(this: any) { this.sides = 0; }
(Shape as any).count = 7;
function Square(this: any) { (Shape as any).call(this); this.sides = 4; }
_inherits(Square, Shape);
function Tile(this: any) { (Square as any).call(this); }
_inherits(Tile, Square);
console.log("_inherits", new (Tile as any)().sides, (Tile as any).count, arraysAreSlow());

const methods = { first() { return "a"; }, second() { return "b"; } };
(methods as any).__proto__ = { third() { return "c"; } };
console.log("a store to __proto__ of a literal", (methods as any).third(), arraysAreSlow());

type Point = { x: number; y: number };
const origin: Point = { x: 0, y: 0 };
const moved: Point = { x: 1, y: 2 };
const heir = Object.create(origin);
const chain = (object: object, prototype: object): void => { Object.setPrototypeOf(object, prototype); };
chain(origin, moved);
chain(moved, { z: 3 });
console.log("records in a chain", heir.x, (heir as any).z, arraysAreSlow());

class Counter { count = 0; add(): number { return ++this.count; } }
const counter = new Counter();
const onTop = Object.create(counter);
Object.setPrototypeOf(onTop, Object.create(counter));
console.log("an instance as a prototype", onTop.add(), counter.count, arraysAreSlow());

const arrow = () => 1;
const bound = f1.bind(null);
Object.setPrototypeOf(arrow, bound);
Object.setPrototypeOf(bound, g1);
console.log("an arrow function and a bound one", Object.getPrototypeOf(arrow) === bound, Object.create(arrow) !== null, arraysAreSlow());

class Parent { static made = 1; }
class Child extends Parent {}
class Grandchild extends Child {}
const fromClass = Object.create(Grandchild);
console.log("classes", Grandchild.made, fromClass.made, Object.getPrototypeOf(Grandchild) === Child, arraysAreSlow());

type Table = { 1: string; 2: string; name: string };
const tables: Table[] = [];
for (let i = 0; i < 3; i++) tables.push({ 1: "a" + i, 2: "b" + i, name: "t" + i });
type Pair = { left: number; right: number };
const keyed: Pair = { left: 7, right: 8 };
(keyed as any)[5] = "five";
function numbered() { return 0; }
(numbered as any)[3] = "three";
console.log("indices on what nothing inherits from", tables[2][1], Object.keys(tables[0]).join(), (keyed as any)[5], (numbered as any)[3], arraysAreSlow());

const above: Pair = { left: 1, right: 2 };
Object.setPrototypeOf(above, Array.prototype);
const sparse: any = [0, , 2];
Object.setPrototypeOf(sparse, above);
(above as any)[1] = "one";
console.log("an element of a record that an array inherits from", sparse[1], sparse.indexOf("one"), sparse.join(), sparse.slice(0).join(), 1 in sparse, arraysAreSlow());

const middle: any = Object.create(null);
const lowest = Object.create(middle);
Object.setPrototypeOf(middle, counter);
console.log("an instance above what others inherit from", lowest.add(), lowest.count, arraysAreSlow());

class Sealed { readonly kind = "sealed"; constructor(public size: number) {} area(): number { return this.size * this.size; } }
function Wrapper(this: any) { this.own = 1; }
new (Wrapper as any)();
Object.setPrototypeOf(Wrapper.prototype, new Sealed(3));
console.log("an instance above the prototype of a function", new (Wrapper as any)().area(), arraysAreSlow());

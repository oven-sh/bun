// STATISTIC: ConstructsDispatchedByCallee >= 4
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
const metadata = new WeakMap(), columns = new Map();
const Injectable = () => target => { metadata.set(target, { injectable: true }); };
const Column = () => (target, key) => { if (!columns.has(target.constructor)) columns.set(target.constructor, []); columns.get(target.constructor).push(key); };
const Extended = label => target => class extends target { constructor(...args) { super(...args); this.label = label; } };
const Replaced = target => function (...args) { return { replaced: args.length, sum() { return -1; } }; };
const Wrapped = target => new Proxy(target, { construct(to, args, newTarget) { const made = Reflect.construct(to, args, newTarget); made.wrapped = true; return made; } });
let Point = class Point { constructor(x, y) { this.x = x; this.y = y; this.next = undefined; } sum() { return this.x + this.y; } };
__decorate([Column()], Point.prototype, "x", void 0);
Point = __decorate([Injectable()], Point);
let Labeled = class Labeled { constructor(x) { this.x = x; } sum() { return this.x; } };
Labeled = __decorate([Extended("one"), Extended("two")], Labeled);
let Other = class Other { constructor(x) { this.x = x; } sum() { return this.x; } };
Other = __decorate([Replaced], Other);
let Proxied = class Proxied { constructor(x) { this.x = x; } sum() { return this.x; } };
Proxied = __decorate([Wrapped], Proxied);
function makePoint(i, next) { const made = new Point(i, 1); made.next = next; return made; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let made; for (let k = 0; k < 8; k++) made = makePoint(k, made); for (; made; made = made.next) sum += made.sum(); } return sum; }
const make = [i => new Point(i, 2), i => new Labeled(i), i => new Other(i), i => new Proxied(i)];
console.log(run(100));
for (const one of make) for (let i = 0; i < 2; i++) { const made = one(i); console.log(Object.keys(made).join(), made.sum(), made.constructor.name, JSON.stringify(made)); }
console.log(make[0](1) instanceof Point, make[1](1) instanceof Labeled, metadata.get(Point).injectable, columns.get(Point).join());
function later() { return new Late(1); }
try { later(); } catch (error) { console.log(error.name); }
let Late = class Late { constructor(x) { this.x = x; } };
console.log(later().x);
Late = null;
try { later(); } catch (error) { console.log(error.name); }
Late = class { constructor(x) { this.z = x + 1; } };
console.log(Object.keys(later()).join(), later().z);
Late = Point;
console.log(Object.keys(later()).join(), later().sum());

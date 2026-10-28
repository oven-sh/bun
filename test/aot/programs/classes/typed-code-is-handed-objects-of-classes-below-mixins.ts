// Typed functions that take the class above are handed objects of that class, of classes below it, and of classes below a mixin over it.
type Constructor<T = {}> = new (...args: any[]) => T;
class Emitter { listeners = 0; count = 1; on(): this { this.listeners++; return this; } total(): number { return this.count + this.listeners; } }
class Direct extends Emitter { direct = 10; total(): number { return super.total() + this.direct; } }
function Countable<TBase extends Constructor<Emitter>>(Base: TBase) { return class extends Base { n = 100; total(): number { return super.total() + this.n; } grow(): number { return ++this.n; } }; }
function Named<TBase extends Constructor>(Base: TBase) { return class extends Base { name = "x"; label(): string { return this.name + "!"; } }; }
class A extends Countable(Emitter) { a = 1000; }
class B extends Named(Countable(Direct)) { b = 2000; }
class C extends Countable(Named(Emitter)) {}
interface HasTotal { total(): number }
function viaClass(e: Emitter): number { return e.on().total() + e.count; }
function viaInterface(e: HasTotal): number { return e.total(); }
function fields(e: Emitter): string { return Object.keys(e).join(","); }
const all: Emitter[] = [new Emitter(), new Direct(), new A(), new B(), new C()];
const lines: (string | number)[] = [];
let sum = 0;
for (let round = 0; round < 200; round++) for (const e of all) sum += viaClass(e) + viaInterface(e);
lines.push(sum);
for (const e of all) lines.push(fields(e));
const a = new A(), b = new B(), c = new C();
lines.push(a.grow() + a.a, b.grow() + b.b + b.direct, b.label(), c.grow(), c.label());
lines.push(String(a instanceof Emitter), String(b instanceof Direct), String(c instanceof Direct));
console.log(lines.join(" "));

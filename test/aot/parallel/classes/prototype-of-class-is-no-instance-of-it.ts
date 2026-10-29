// TypeScript gives `C.prototype` the type of the instances of `C`. The object has their methods and none of their fields.
const out: string[] = [];
function say(...parts: unknown[]) { out.push(parts.map(String).join(" ")); }

class A {
  a: number;
  label = "a";
  constructor(a: number) { this.a = a; }
  area(): number { return this.a + 1; }
  get size(): number { return this.a * 2; }
  describe(): string { return `${this.label}:${this.a}`; }
}
class B extends A {
  b: number;
  constructor(a: number) { super(a); this.b = 2; }
  area(): number { return A.prototype.area.call(this) + this.b; }
  describe(): string { return "B " + A.prototype.describe.apply(this, []); }
}
function takesAnA(v: A): string { return typeof v.a + " " + typeof v.label + " " + typeof v.area; }
function readsFields(v: A): number { return v.a + 1; }

const kept: A[] = [new B(1), new A(2), new B(3)];
let sum = 0;
for (let i = 0; i < 30; i++) sum += kept[i % 3].area();
say(sum, kept.map(v => v.describe()).join());

const held = A.prototype;
say(held.a, held.label, typeof held.area, held.area.call(new A(4)), held.area.call({ a: 10 } as A), Number.isNaN(held.area()), Number.isNaN(held.size));
say(takesAnA(A.prototype), takesAnA(new A(1)), Number.isNaN(readsFields(A.prototype)), readsFields(new A(1)));
say(A.prototype instanceof A, B.prototype instanceof A, B.prototype instanceof B, A.prototype.constructor === A, B.prototype.constructor === B);
say(Object.getOwnPropertyNames(A.prototype).join(), Object.getOwnPropertyNames(B.prototype).join(), Object.keys(A.prototype).length);
say(Object.getPrototypeOf(B.prototype) === A.prototype, Object.getPrototypeOf(new B(1)) === B.prototype, "a" in A.prototype, "area" in B.prototype);

const either: A = sum > 0 ? A.prototype : new A(9);
say(either.a, either.describe());
const list: A[] = [A.prototype, new A(5), B.prototype];
say(list.map(v => String(v.a)).join(), list.map(v => typeof v.area).join());

(A.prototype as any).added = 7;
say((new A(1) as any).added, (new B(1) as any).added, (held as any).added);
A.prototype.area = function (this: A) { return this.a + 100; };
say(new A(1).area(), new B(1).area(), held.area.call(new A(2)));

function F(this: any, x: number) { this.x = x; }
F.prototype.get = function () { return this.x; };
say(typeof F.prototype.get, F.prototype.x, F.prototype.get.call({ x: 3 }), new (F as any)(4).get());

console.log(out.join("\n"));

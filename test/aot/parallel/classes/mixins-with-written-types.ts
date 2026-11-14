// Mixins that are called several times get a copy a call. What types name the class of the mixin still hold.
type Constructor<T = {}> = new (...args: any[]) => T;
class Point {
  constructor(public x: number, public y: number) {}
  sum(): number { return this.x + this.y; }
}
class Pair {
  constructor(public p: Point, public k: number) {}
}
function Named<TBase extends Constructor>(Base: TBase) {
  return class Named extends Base {
    private hits: number = 0;
    label: string = "n";
    size(): number { return this.label.length + ++this.hits; }
    static create(...args: any[]): any { return new this(...args); }
  };
}
const Counted = <TBase extends Constructor>(Base: TBase) =>
  class extends Base {
    #count: number = 0;
    tick(): number { return ++this.#count; }
    static counts(o: object): boolean { return #count in o; }
  };
type WithName = InstanceType<ReturnType<typeof Named<typeof Point>>>;
function describe(named: WithName): string { return named.label + named.size() + named.sum(); }

class A extends Named(Counted(Point)) { total(): number { return this.sum() + this.size() + this.tick(); } }
class B extends Counted(Named(Pair)) { go(): number { return this.p.sum() + this.k + this.tick(); } }
const C = Named(Point);
const D = Named(Point);
const held: WithName[] = [new C(1, 2), new D(3, 4)];
let other: InstanceType<typeof C> = new D(5, 6);

function run(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const b = new B(new A(i, 1), i & 7);
    s = (s + b.go() + (b.p as A).total() + new C(i, 1).size() + b.size()) | 0;
  }
  return s;
}
console.log(run(50), held.map(describe).join(), describe(other), describe(new A(1, 2)));
console.log(Object.keys(new A(1, 2)).join(), Object.keys(new B(new Point(1, 2), 3)).join(), new C(1, 2) instanceof D, new D(1, 2) instanceof Point, C.name, A.create(1, 2).total());
console.log(Counted(Point).counts(new A(1, 2)), B.counts(new B(new Point(1, 2), 1)), B.counts(new A(1, 2)));
(C.prototype as any).size = function () { return 100; };
console.log(run(3), describe(held[0]!), describe(held[1]!));
other = new C(7, 8);
console.log(describe(other), other.size());

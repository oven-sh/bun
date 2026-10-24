// Held from creation: Reflect.construct runs a class's constructor on an object that native code made from the `prototype` of another function, so `this` is no instance of the class.
class Base {
  size = 2;
  constructor(public scale: number) {
    this.size = this.measure() * scale;
  }
  measure(): number {
    return 3;
  }
}

class Derived extends Base {
  extra = 10;
  measure(): number {
    return 4;
  }
}

function Stranger(this: any) {}
Stranger.prototype.measure = function (): string {
  return "5";
};

const honest = new Base(2);
const strange = Reflect.construct(Base, [2], Stranger) as Base;
const crossed = Reflect.construct(Derived, [2], Base) as Derived;
const bound = Reflect.construct(Base, [3], Derived.bind(null)) as Base;
console.log(
  honest.size, strange.size, typeof strange.size, strange instanceof Base, strange instanceof (Stranger as any),
  crossed.size, crossed.extra, crossed instanceof Derived, bound.size, bound instanceof Derived,
);

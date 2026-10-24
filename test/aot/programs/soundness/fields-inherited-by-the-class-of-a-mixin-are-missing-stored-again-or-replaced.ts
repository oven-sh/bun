// The class of a mixin inherits fields that its base stores on some paths only, stores once, or fills with functions. What holds for the base's own instances need not hold for these.
const names: string[] = JSON.parse('["id", "x", "handler"]');
{
  class P {
    x?: number;
    constructor(withX: boolean) {
      if (withX) this.x = 1;
    }
    get(): number {
      return this.x === undefined ? -1 : this.x;
    }
  }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  const a: P = new C(true);
  const b: P = new C(false);
  console.log("some paths", a.get(), b.get(), "x" in a, "x" in b, Object.keys(a).join("+"), Object.keys(b).join("+"), JSON.stringify(a), JSON.stringify(b));
  b.x = 2;
  console.log("some paths", b.get(), Object.keys(b).join("+"));
}
{
  class P {
    id: number = 1;
    twice(): number {
      return this.id * 2;
    }
  }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  const a: P = new C();
  const b: P = new C();
  function bump(o: any): void {
    o[names[0]] = 5;
  }
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    total += a.twice() + b.twice();
    if (i === 1500) bump(b);
  }
  console.log("stored once", total, a.id, b.id);
}
{
  class P {
    x: number = 3;
    handler = (): number => this.x + 1;
  }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  const a: P = new C();
  const b: P = new C();
  (b as any)[names[2]] = () => 100;
  const c: P = new C();
  (c as any).handler = function (this: P) { return this.x * 2; };
  console.log("functions", a.handler(), b.handler(), c.handler(), typeof a.handler, a.handler === a.handler);
}
{
  class P {
    x: number = 1;
  }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  const a: P = new C();
  const b: P = new C();
  delete (a as any).x;
  Object.defineProperty(b, "x", { get() { return 9; }, configurable: true, enumerable: true });
  console.log("removed and redefined", String((a as any).x), "x" in a, Object.keys(a).join("+"), (b as any).x, Object.keys(b).join("+"), JSON.stringify(a), JSON.stringify(b));
}

// STATISTIC: MethodCallsThroughTable >= 4
class Base { constructor(readonly n: number) {} }
class A extends Base { f(x: number) { return this.n + x; } }
class B extends Base { f(x: number) { return this.n * 2 + x; } }
class C extends Base { f(x: number) { return this.n * 3 + x; } }
class D extends Base { f(x: number) { return this.n * 4 + x; } }
type Any = A | B | C | D;
function chain(all: Base[], turns: number) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const a = all[turn & 3] as Any, b = all[(turn + 1) & 3] as Any, c = all[(turn + 2) & 3] as Any, d = all[(turn + 3) & 3] as Any;
    total += a.f(b.f(c.f(d.f(turn))));
  }
  return total;
}
const byValue = [chain];
const all: Base[] = [new A(1), new B(2), new C(3), new D(4)];
console.log(byValue[0](all, 100));
all.push(new Base(5));
try { console.log(byValue[0]([all[4], all[1], all[2], all[3]], 4)); } catch (error) { console.log((error as Error).constructor.name, (error as Error).message); }

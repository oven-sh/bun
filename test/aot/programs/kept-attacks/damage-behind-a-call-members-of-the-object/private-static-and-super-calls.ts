// Calls of a private method, of a static method and of a method of the base class through `super` have one possible callee each. Each of them damages the object in a round of its own, and the method that made the call reads `this` behind it.
let mode = 0;
class Base {
  a: number;
  constructor(a: number) {
    this.a = a;
  }
  check(): number {
    if (mode === 3) delete (this as any).a;
    return 3;
  }
}
class Derived extends Base {
  b: number;
  constructor(a: number, b: number) {
    super(a);
    this.b = b;
  }
  #hidden(): number {
    if (mode === 1) delete (this as any).b;
    return 1;
  }
  static helper(d: Derived): number {
    if (mode === 2) (d as any).b = "text";
    return 2;
  }
  check(): number {
    const before = this.a + this.b;
    const first = this.#hidden();
    const afterFirst = this.a + this.b;
    const second = Derived.helper(this);
    const afterSecond = this.a + this.b;
    const third = super.check();
    trail = before + " " + first + ":" + afterFirst + " " + second + ":" + afterSecond + " " + third + ":" + (this.a + this.b);
    return 0;
  }
}
let trail = "";

function holder(d: Derived): string {
  const before = d.a + d.b;
  d.check();
  return before + " [" + trail + "] " + d.a + "," + d.b;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Derived(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}

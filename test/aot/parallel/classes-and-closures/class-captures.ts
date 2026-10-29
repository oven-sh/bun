// Classes that are evaluated more than once: their members capture the variables of the enclosing scope.
function make(base: number, label: string) {
  let count = 0;
  class Counter {
    static made = 0;
    #secret = base * 2;
    step = () => this.#secret + base;
    constructor(public start: number) { Counter.made++; }
    next() { count++; return this.start + base + count; }
    name() { return label + Counter.made; }
    static create() { return new Counter(base); }
    fresh() { return new Counter(this.start + 1); }
    inner() { return [1, 2].map(x => x + this.start + base + count).join(); }
  }
  return { Counter, read: () => count };
}
const a = make(10, "a"), b = make(100, "b");
const x = new a.Counter(1), y = new b.Counter(2);
console.log(x.next(), x.next(), y.next(), a.read(), b.read(), x.name(), y.name(), x.step(), y.step(), x.inner());
console.log(a.Counter.create().start, x.fresh().start, a.Counter.made, b.Counter.made, a.Counter === b.Counter, x instanceof a.Counter, x instanceof b.Counter);
function derived(extra: number) {
  class Base { constructor(public v: number) {} get() { return this.v + extra; } }
  class Derived extends Base { constructor(v: number) { super(v * 2); } get() { return super.get() + extra; } static tag = (() => extra)(); static { Derived.tag += 1; } }
  return new Derived(3).get() + Derived.tag;
}
console.log(derived(1), derived(5));
function nestedClasses(k: number) {
  class Outer { #hidden = k; make() { const outer = this; return new (class Inner { read() { return outer.#hidden + k; } })(); } }
  return new Outer().make().read();
}
console.log(nestedClasses(4));
function inLoop() { const out: number[] = []; for (let i = 0; i < 3; i++) { const C = class { v() { return i; } }; out.push(new C().v()); } return out.join(); }
console.log(inLoop());
class Speaker { who() { return "base"; } }
class Loud extends Speaker { who() { return "loud"; } viaArrow() { return (() => super.who())(); } static tag() { return "t"; } }
class Louder extends Loud { static viaArrow() { return (() => super.tag())(); } }
console.log(new Loud().viaArrow(), Louder.viaArrow());

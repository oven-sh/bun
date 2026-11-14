// COUNT: counter:ClassDefinitionsRepeated >= 100
// Classes with methods and accessors that a function makes again and again: every one has members, names and orders of its own, whatever the others went through.
const { getPrototypeOf, defineProperty, getOwnPropertyDescriptor } = Object;
const out = [];
function plain(v) {
  class Plain { constructor() { this.v = v; } get one() { return this.v + 1; } two(a) { return a + this.v; } static three() { return 3; } *four() { yield this.v; yield* [1, 2]; } async five() { return 5; } set six(w) { this.v = w; } }
  return Plain;
}
function below(Base, v) { return class Below extends Base { two(a) { return super.two(a) * 2; } static three() { return super.three() + 1; } get one() { return super.one + 10; } own() { return v; } }; }
function odd() { return class { static name() { return "name"; } static length() { return 2; } 3() { return "three"; } "a b"() { return 1; } get both() { return this.w; } set both(w) { this.w = w; } [Symbol.iterator]() { return [1, 2][Symbol.iterator](); } twice() { return 1; } static field = 1; static { this.field += 1; } }; }
function named(v) { return { make: class { #p = v; get p() { return this.#p; } static is(o) { return #p in o; } toString() { return `p${this.#p}`; } } }.make; }
const keys = o => Reflect.ownKeys(o).map(String).join();
const shape = C => [keys(C), keys(C.prototype), ...Reflect.ownKeys(C.prototype).map(k => { const d = getOwnPropertyDescriptor(C.prototype, k); return +!!d.get + "" + +!!d.set + +d.enumerable + +d.configurable + typeof d.value; })].join("|");
let last, sum = 0;
for (let k = 0; k < 120; k++) {
  const P = plain(k), o = new P(), B = below(P, k), b = new B(), O = odd(), N = named(k), n = new N();
  o.six = k + 1;
  sum += o.one + o.two(1) + P.three() + b.one + b.two(1) + B.three() + b.own() + [...o.four()].length + new O()[3]().length + [...new O()].length + O.field + O.length() + O.name().length + n.p + +N.is(n) + +N.is(o) + String(n).length;
  if (last) sum += +(last.constructor !== P) + +(getPrototypeOf(last) !== P.prototype) + +(P.prototype.two !== last.two) + +!(last instanceof P) + +(o instanceof P);
  if (k % 30 === 7) { out.push(shape(P), shape(B), shape(O), shape(N), P.name, B.name); P.prototype.two = () => 100; defineProperty(P.prototype, "one", { value: 7 }); delete P.three; P.extra = 1; sum += o.two(1) + o.one + +("three" in P); }
  if (k % 30 === 11) { Object.setPrototypeOf(P.prototype, { deep: 1 }); sum += o.deep; Object.freeze(P.prototype); P.prototype.two = 1; out.push(typeof P.prototype.two); }
  if (k % 30 === 13) { const own = new O(); own.both = 4; sum += own.both; O.prototype.twice = 1; out.push(keys(O)); }
  last = o;
}
console.log(sum); for (const line of out) console.log(line);
// The same name stored by another evaluation, and a class that is made while its first evaluation is gone.
let alive = []; for (let k = 0; k < 400; k++) { const C = plain(k); if (k % 50 === 0) alive.push(new C()); }
console.log(alive.map(o => o.two(1) + o.one).join(), new Set(alive.map(o => o.two)).size, new Set(alive.map(getPrototypeOf)).size);
plain(1).prototype.five.call({}).then(v => console.log(v));

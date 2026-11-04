// `#x in o`
class A { #x = 1; #m() {} static #s = 1; static #sm() {} get #g() { return 1; }
  static x(o: any) { return #x in o; } static m(o: any) { return #m in o; } static s(o: any) { return #s in o; } static sm(o: any) { return #sm in o; } static g(o: any) { return #g in o; }
  isA(o: A | { q: number }) { return #x in o; } }
class B extends A {}
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const values: [string, any][] = [["a", new A()], ["b", new B()], ["A", A], ["B", B], ["{}", {}], ["proto", A.prototype], ["null", null], ["undefined", undefined], ["1", 1], ["str", "s"], ["created", Object.create(new A())]];
for (let round = 0; round < 2; round++) for (const [name, v] of values) {
  attempt(name + " x", () => A.x(v)); attempt(name + " m", () => A.m(v)); attempt(name + " s", () => A.s(v)); attempt(name + " sm", () => A.sm(v)); attempt(name + " g", () => A.g(v));
}
const a = new A(); let n = 0;
for (let i = 0; i < 1000; i++) if (a.isA(i & 1 ? a : { q: 1 })) n++;
console.log(n);

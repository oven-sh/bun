// Classes at the top level: static blocks, static fields, computed keys and heritage run where they stand.
const log: string[] = [];
function note<T>(text: string, value: T) { log.push(text); return value; }
class Plain { a = 1; static s = { v: 1 }; m() { return this.a; } get g() { return 2; } static sm() { return 3; } }
class Child extends Plain { b = 2; m() { return super.m() + this.b; } }
class WithEffects { static a = note("static a", 1); static b = note("static b", 2); }
class Keyed { [note("key", "k")]() { return 4; } }
const Expression = class Named { static self = Named; };
const mixin = (Base: typeof Plain) => class extends Base { extra() { return 5; } };
const Mixed = mixin(Plain);
class Private { #p = 6; static #sp = 7; read() { return this.#p + Private.#sp; } static has(o: object) { return #p in o; } }
class FromBuiltin extends Map<string, number> { twice(k: string) { return (this.get(k) ?? 0) * 2; } }
class Failing extends Error { code = "E"; }
abstract class Abstract { abstract f(): number; g() { return this.f(); } }
class Concrete extends Abstract { f() { return 8; } }
const instance = new Child();
const instances = [new Plain(), new Child()];
log.push("end");
function main(which: string) {
  console.log(log.join());
  if (which === "child") console.log(new Child().m(), Object.getPrototypeOf(Child) === Plain);
  console.log(new Plain().m(), new Plain().g, Plain.sm(), Plain.s.v, instance.m(), instances.length, instance instanceof Plain);
  console.log(WithEffects.a + WithEffects.b, (new Keyed() as any).k(), Expression.self === Expression, Expression.name, new Mixed().extra(), Mixed.name);
  console.log(new Private().read(), Private.has(new Private()), Private.has({}));
  const m = new FromBuiltin([["a", 2]]);
  console.log(m.twice("a"), m instanceof Map, new Failing("f").code, new Failing("f") instanceof Error, new Concrete().g());
  console.log(Object.getOwnPropertyNames(Plain).sort().join(), Object.getOwnPropertyNames(Plain.prototype).sort().join(), Child.name, Child.length);
}
main(process.argv[2] ?? "");

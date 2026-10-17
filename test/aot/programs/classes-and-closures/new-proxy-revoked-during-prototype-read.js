// Where new.target has no object as its `prototype`, the realm of new.target gives one, and a revoked proxy has no realm: a TypeError.
function attempt(name, f) { try { console.log(name, f()); } catch (e) { console.log(name, e.constructor.name); } }
function Plain() { this.made = true; }
class Base { constructor() { this.made = true; } }
class Heir extends Base {}
function ReadsNewTarget() { this.made = typeof new.target; }
for (const [name, target] of [["a function expression", function () {}], ["a function", Plain], ["a class", Base], ["a derived class", Heir], ["a function that reads new.target", ReadsNewTarget]]) {
  for (let round = 0; round < 2; round++) {
    const revoking = Proxy.revocable(target, { get() { revoking.revoke(); } });
    attempt(name + ", revoked by its get trap, new", () => typeof new revoking.proxy());
    const handed = Proxy.revocable(target, { get() { handed.revoke(); } });
    attempt(name + ", revoked by its get trap, Reflect.construct", () => typeof Reflect.construct(target, [], handed.proxy));
    const kept = Proxy.revocable(target, { get() { return undefined; } });
    attempt(name + ", no prototype, not revoked", () => Object.getPrototypeOf(new kept.proxy()) === Object.prototype);
    const number = Proxy.revocable(target, { get(of, key) { return key === "prototype" ? 5 : of[key]; } });
    attempt(name + ", a number as prototype", () => Object.getPrototypeOf(Reflect.construct(target, [], number.proxy)) === Object.prototype);
    const other = { other: true };
    const object = new Proxy(target, { get(of, key) { return key === "prototype" ? other : of[key]; } });
    attempt(name + ", an object as prototype", () => Object.getPrototypeOf(new object()) === other);
  }
}
const handle = Proxy.revocable(function () {}, { get() { handle.revoke(); } });
const f = handle.proxy;
attempt("written in place", () => typeof new f());

// Classes without fields below many built-in classes: their own methods call the methods of the class above, on objects as made, with own members, relinked, and made for another class.
const lines = [];
class M extends Map { pick(k) { return this.get(k); } n() { return this.size; } }
class S extends Set { pick(k) { return this.has(k); } n() { return this.size; } }
class A extends Array { pick(k) { return this[k]; } n() { return this.length; } }
class E extends Error { pick() { return this.message; } n() { return this.name.length; } }
class P extends Promise { pick() { return typeof this.then; } n() { return 1; } }
class R extends RegExp { pick(k) { return this.test(k); } n() { return this.source.length; } }
class U extends Uint8Array { pick(k) { return this[k]; } n() { return this.length; } }
class D extends Date { pick() { return this.getTime(); } n() { return 2; } }
class W extends WeakMap { pick(k) { return this.has(k); } n() { return 3; } }
class B extends ArrayBuffer { pick() { return this.byteLength; } n() { return 4; } }
class F extends Function { pick() { return this(); } n() { return this.length; } }
class O extends Object { pick(k) { return this[k]; } n() { return Object.keys(this).length; } }
const key = {};
const make = [() => new M([["a", 1]]), () => new S(["a"]), () => new A(5, 6, 7), () => new E("boom"), () => new P((r) => r(1)), () => new R("a+"), () => new U([9, 8]), () => new D(5), () => new W([[key, 1]]), () => new B(8), () => new F("return 11"), () => new O()];
const keys = ["a", "a", 1, 0, 0, "caab", 1, 0, key, 0, 0, "x"];
function use(object, k) { try { return String(object.pick(k)) + "/" + object.n(); } catch (error) { return error.constructor.name; } }
for (let round = 0; round < 40; round++) {
  const row = make.map((f, i) => use(f(), keys[i]));
  if (round % 13 === 0) lines.push(row.join(" "));
}
lines.push(make.map((f, i) => { const o = f(); try { o.pick = () => "own"; } catch {} return use(o, keys[i]); }).join(" "));
lines.push(make.map((f, i) => { const o = f(); try { o.extra = 1; } catch {} return use(o, keys[i]); }).join(" "));
lines.push(make.map((f, i) => { const o = f(); Object.setPrototypeOf(o, { pick() { return "cut"; }, n() { return 0; } }); return use(o, keys[i]); }).join(" "));
lines.push(make.map((f, i) => { const o = f(); try { Object.freeze(o); } catch {} return use(o, keys[i]); }).join(" "));
const classes = [M, S, A, E, P, R, U, D, W, B, F, O];
lines.push(classes.map((K, i) => { try { return use(Reflect.construct(Object.getPrototypeOf(K), i === 4 ? [(r) => r(1)] : i === 7 ? [5] : [], K), keys[i]); } catch (error) { return error.constructor.name; } }).join(" "));
lines.push(classes.map((K, i) => { try { return use(Reflect.construct(K, i === 4 ? [(r) => r(1)] : i === 7 ? [5] : [], classes[(i + 1) % classes.length]), keys[i]); } catch (error) { return error.constructor.name; } }).join(" "));
lines.push(classes.map((K, i) => use(Object.create(K.prototype), keys[i])).join(" "));
console.log(lines.join("\n"));

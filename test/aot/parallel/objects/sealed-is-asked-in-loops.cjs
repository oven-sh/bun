// Object.isSealed of objects of every kind and integrity, in loops, before and after they change.
class Point { constructor() { this.x = 1; } }
const makers = [() => ({}), () => ({ a: 1 }), () => [], () => [1, 2], () => new Point(), () => function () { }, () => () => 1, () => new Map(), () => new Uint8Array(2), () => new Uint8Array(0), () => new Proxy({ a: 1 }, {}), () => new Proxy({}, { isExtensible() { return true; }, ownKeys() { return []; } }), () => Object.create(null), () => new Date(0), () => /x/, () => Promise.resolve(), () => Symbol("s"), () => "text", () => 5, () => null, () => undefined, () => true, () => 1n, () => arguments, () => globalThis, () => { const o = { open: 1 }; Object.defineProperty(o, "fixed", { value: 1 }); return o; }, () => new String("abc"), () => ({ get a() { return 1; } }), () => ({ [Symbol.iterator]: 1 })];
const changes = [o => o, o => Object.preventExtensions(o), o => Object.seal(o), o => Object.freeze(o), o => { if (o && typeof o === "object") for (const k of Reflect.ownKeys(o)) Reflect.defineProperty(o, k, { configurable: false }); return Object.preventExtensions(o); }, o => { try { delete o.a; } catch { } return Object.preventExtensions(o); }];
const lines = [];
for (const change of changes) {
  const all = makers.map(make => { const o = make(); if (o === globalThis) return {}; try { return change(o); } catch (error) { return error.name; } });
  let sealed = "", frozen = "", extensible = "", own = "";
  for (let i = 0; i < all.length; i++) { const o = all[i]; try { sealed += Object.isSealed(o) ? 1 : 0; frozen += Object.isFrozen(o) ? 1 : 0; extensible += Object.isExtensible(o) ? 1 : 0; own += Object.isSealed.call(null, o) === all.slice(i, i + 1).every(Object.isSealed) ? 1 : 0; } catch (error) { sealed += error.name; } }
  const ask = o => { try { return Object.isSealed(o, 1, 2); } catch (error) { return error.name; } };
  lines.push(sealed, frozen, extensible, own, all.map(ask).join(), all.slice(0, 10).filter(Object.isSealed).length);
}
lines.push(Object.isSealed(), Object.isSealed.length, Object.isSealed.name, [{}, Object.seal({}), 1].map(Object.isSealed).join());
console.log(lines.map(String).join("\n"));

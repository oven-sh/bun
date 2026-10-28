// Classes written out: the class above hands back what it is given, so the private names of the class below land on any object; a second time throws.
const lines = [];
class Identity { constructor(object) { return object; } }
class Stamper extends Identity { #stamp = 1; extra = 2; static has(object) { return #stamp in object; } static read(object) { return object.#stamp; } static bump(object) { return ++object.#stamp; } }
const plain = {};
lines.push(Stamper.has(plain)); new Stamper(plain); lines.push(Stamper.has(plain), Stamper.read(plain), plain.extra, Stamper.bump(plain));
try { new Stamper(plain); lines.push("twice"); } catch (error) { lines.push(error.constructor.name, Stamper.read(plain)); }
for (const target of [[], function () {}, new Map(), Object.create(null), new Proxy({}, {}), Object.freeze({ f: 1 }), Object.preventExtensions({})]) {
  try { new Stamper(target); lines.push(Stamper.has(target), Stamper.read(target)); } catch (error) { lines.push(error.constructor.name, Stamper.has(target)); }
  try { new Stamper(target); lines.push("twice"); } catch (error) { lines.push(error.constructor.name); }
}
for (const bad of [1, "text", null, undefined, Symbol()]) { try { const made = new Stamper(bad); lines.push(typeof made, Stamper.has(made)); } catch (error) { lines.push(error.constructor.name); } }
console.log(lines.join(" "));

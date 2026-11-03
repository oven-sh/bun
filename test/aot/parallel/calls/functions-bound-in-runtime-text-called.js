// Text made at run time binds functions of the program, of its own and of the engine, and calls them: receivers, bound arguments, missing and surplus arguments, errors and their stacks.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);

class Serializer {
  constructor(step) { this.step = step; }
  asInteger(i) { return i + this.step; }
  count() { return arguments.length; }
  rest(...all) { return all.join("|") + "@" + this.step; }
  static make() { return new this(7); }
}
function sloppyReceiver() { return typeof this + ":" + (this === globalThis ? "global" : String(this)); }
function strictReceiver() { "use strict"; return typeof this + ":" + String(this); }
const arrow = i => i * 2;
async function later(i) { return i + this.step; }
function* walk(n) { for (let i = 0; i < n; i++) yield i + this.step; }
function thrower(i) { if (i > 2) throw new RangeError("too large: " + i + " with " + this.step); return i; }
function deep(n) { return n ? 1 + deep.call(this, n - 1) : this.step; }

const serializer = new Serializer(2);
const bindAndCall = text("f", "receiver", "values", "const g = f.bind(receiver); const out = []; for (const value of values) out.push(g(value)); return out");
console.log(bindAndCall(serializer.asInteger, serializer, [1, 2, 3]).join());
console.log(bindAndCall(serializer.asInteger, { step: 10 }, [1, 2, 3]).join());
console.log(bindAndCall(arrow, { step: 10 }, [1, 2, 3]).join());
console.log(bindAndCall(sloppyReceiver, undefined, [0]).join(), bindAndCall(sloppyReceiver, 5, [0]).join(), bindAndCall(sloppyReceiver, "s", [0]).join());
console.log(bindAndCall(strictReceiver, undefined, [0]).join(), bindAndCall(strictReceiver, 5, [0]).join(), bindAndCall(strictReceiver, null, [0]).join());
console.log(bindAndCall(deep, { step: 4 }, [0, 3, 50]).join());

console.log(text("o", "const g = o.count.bind(o); return [g(), g(1), g(1, 2, 3, 4, 5, 6, 7, 8, 9)]")(serializer).join());
console.log(text("o", "const g = o.rest.bind(o); return [g(), g(1), g(1, 2, 3, 4, 5, 6, 7, 8, 9)]")(serializer).join());
console.log(text("o", "const g = o.rest.bind(o, 'a'); const h = o.rest.bind(o, 'a', 'b', 'c', 'd'); return [g(), g(1), h(), h(1, 2)]")(serializer).join());
console.log(text("o", "const g = o.rest.bind(o).bind({ step: 99 }); const h = o.rest.bind(o).bind(null, 'x'); return [g(1), h(2)]")(serializer).join());
console.log(text("o", "const g = o.asInteger.bind(o); return [g.name, g.length, typeof g.prototype, g.call({ step: 50 }, 1), g.apply({ step: 50 }, [2]), Reflect.apply(g, null, [3])]")(serializer).join());

console.log(text("C", "const make = C.make.bind(C); return make().step")(Serializer));
try { text("C", "const g = C.bind(null); return g(1)")(Serializer); } catch (error) { console.log(error.constructor.name, error.message); }
console.log(text("C", "const G = C.bind(null, 3); const made = new G(); return [made.step, made instanceof C, made.asInteger(1)]")(Serializer).join());

console.log(text("own", "const g = own.bind({ step: 5 }); return [g(1), g(2)]")(text("i", "return i + this.step")).join());
console.log(text("const own = function (i) { return i + this.step; }; const g = own.bind({ step: 6 }); let s = 0; for (let i = 0; i < 100; i++) s += g(i); return s")());
console.log(text("const join = Array.prototype.join.bind([1, 2, 3]); const max = Math.max.bind(null); const has = Object.prototype.hasOwnProperty.bind({ a: 1 }); return [join('-'), max(1, 9, 3), has('a'), has('b')]")().join());
console.log(text("const slice = Function.prototype.call.bind(Array.prototype.slice); return slice([1, 2, 3, 4], 1, 3)")().join());

console.log(text("f", "const g = f.bind({ step: 1 }); return [...g(3)]")(walk).join());
console.log(await text("f", "const g = f.bind({ step: 1 }); return g(41)")(later));

const caught = text("f", "const g = f.bind({ step: 8 }); const out = []; for (let i = 0; i < 5; i++) { try { out.push(g(i)); } catch (error) { out.push(error.message); } } return out")(thrower);
console.log(caught.join());
try { text("f", "const g = f.bind({ step: 8 }); return g(3)")(thrower); } catch (error) { console.log(error.stack.split("\n").filter(line => /thrower|bound/.test(line)).length); }
function endless() { return 1 + bound(); }
const bound = text("f", "return f.bind(null)")(endless);
try { text("g", "return g()")(bound); } catch (error) { console.log(error.constructor.name); }

let sum = 0;
const many = text("fs", "n", "let s = 0; for (let i = 0; i < n; i++) s += fs[i % fs.length](i); return s");
const bind = text("f", "receiver", "return f.bind(receiver)");
sum += many([bind(serializer.asInteger, serializer), bind(arrow, null), bind(text("i", "return i + this.step"), { step: 3 }), bind(Math.abs, null), serializer.asInteger.bind(serializer), i => i], 6000);
console.log(sum);

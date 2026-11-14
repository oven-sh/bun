// Functions as operands of ==, +, templates and keys: their text, their own conversions, and those that come later.
class Value { run(x) { return x + 1; } }
class Heir extends Value { static toString() { return "heir"; } }
class Below extends Heir {}
class Number1 { static valueOf() { return 1; } }
class Symbolic { static [Symbol.toPrimitive](hint) { return hint === "default" ? kind : hint; } }
const kind = Symbol("kind");
function plain(a, b) { return a + b; }
const arrow = x => x;
const bound = plain.bind(null, 1);
async function later() {}
function* steps() {}
const object = { method() {}, get got() { return 1; } };
const functions = [Value, Heir, Below, Number1, Symbolic, plain, arrow, bound, later, steps, object.method, Math.max, Array, Proxy, new Proxy(plain, {})];
globalThis[["fun", "ctions"].join("")] = functions;
const given = globalThis.functions;
const others = [kind, Symbol.iterator, Symbol.for("kind"), 1, "heir", "1", true, null, undefined, 5n, NaN];
const same = (a, b) => { try { return a == b; } catch (e) { return e.constructor.name; } };
for (let turn = 0; turn < 3; turn++)
    console.log(given.map(f => others.map(o => (same(f, o) === true ? 1 : same(f, o) === false ? 0 : same(f, o)) + "" + (same(o, f) === true ? 1 : same(o, f) === false ? 0 : 2)).join("")).join(" "));
const text = f => { try { return String(f); } catch (e) { return e.constructor.name; } };
const added = f => { try { return f + ""; } catch (e) { return e.constructor.name; } };
const template = f => { try { return `${f}`; } catch (e) { return e.constructor.name; } };
console.log(given.map(f => [text(f) === text(f), text(f) === template(f), typeof added(f), text(f) === Function.prototype.toString.call(f)].join()).join(" "));
const held = {};
for (const f of [Value, plain, arrow, object.method]) held[f] = (held[f] ?? 0) + 1;
for (const f of [Value, plain, arrow, object.method]) held[f]++;
console.log(Object.values(held).join(), Object.keys(held).length, held[Value], text(Value) in held);
Bun.gc(true);
console.log(held[Value], held[plain], text(Value) === String(Value), same(Value, text(Value)), same(text(plain), plain), same(Value, kind), same(kind, plain));
// Conversions that functions get later.
let count = 0;
Value.toString = () => { count++; return "own"; };
plain.valueOf = () => kind;
arrow[Symbol.toPrimitive] = () => { count++; return kind; };
console.log(same(Value, kind), same(Value, "own"), same(plain, kind), same(kind, plain), same(arrow, kind), same(kind, arrow), same(arrow, Symbol.iterator), count);
delete Value.toString; delete plain.valueOf; delete arrow[Symbol.toPrimitive];
console.log(same(Value, kind), same(Value, "own"), same(plain, kind), same(arrow, kind), count);
Object.setPrototypeOf(plain, { __proto__: Function.prototype, valueOf() { return 7; } });
console.log(same(plain, 7), same(plain, kind), same(kind, plain));
Object.setPrototypeOf(arrow, null);
console.log(same(arrow, kind), same(kind, arrow), same(arrow, "x"), text(arrow), template(arrow));
Below.valueOf = () => { throw new RangeError("value"); };
console.log(same(Below, kind), same(Below, null), same(undefined, Below), added(Below));

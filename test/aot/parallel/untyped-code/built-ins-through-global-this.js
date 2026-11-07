// A module that declares its own Number, Array or Object reaches the built-ins as globalThis.Number and so on. These are the same built-ins; a globalThis, self or window that the program binds or replaces is not.
const Number = { isNaN: () => "the module's own" };
const Array = { isArray: () => "the module's own" };
const said = [];
const values = [0, -0, 1.5, NaN, Infinity, 2 ** 53, 2 ** 53 - 1, "1", "x", null, undefined, {}, [], [1], true, 10n, Symbol.for("s")];
const show = v => (typeof v === "symbol" || typeof v === "bigint" ? v.toString() : Object.is(v, -0) ? "-0" : globalThis.Array.isArray(v) ? "[" + v + "]" : String(v));
for (const v of values)
  said.push(show(v) + ": " + [globalThis.Number.isNaN(v), globalThis.Number.isFinite(v), globalThis.Number.isInteger(v), globalThis.Number.isSafeInteger(v), globalThis.Array.isArray(v), Number.isNaN(v), Array.isArray(v)].join(" "));
said.push("parse: " + [globalThis.Number.parseInt("12px"), globalThis.Number.parseFloat("1.5e3x"), globalThis.Number.parseInt("z", 36), globalThis.Number.MAX_SAFE_INTEGER, globalThis.Number.EPSILON > 0].join(" "));
said.push("objects: " + [globalThis.Object.keys({ a: 1, b: 2 }), globalThis.Object.entries({ a: 1 }), globalThis.JSON.stringify({ a: [1] }), globalThis.Math.abs(-3), globalThis.Math.max(1, "7", 3), globalThis.Symbol.keyFor(globalThis.Symbol.for("k"))].join(" | "));
said.push("made: " + [new globalThis.Map([[1, 2]]).get(1), new globalThis.Error("text").message, new globalThis.Set([1, 1]).size, globalThis.Array.from("ab").length, new globalThis.Array(3).length].join(" "));
said.push("the same: " + [globalThis.Number === (0).constructor, globalThis.globalThis.Number === globalThis.Number, globalThis.Array === [].constructor, typeof globalThis.Number, globalThis.Number.name].join(" "));
const held = globalThis.Number; const method = globalThis.Number.isNaN;
said.push("held: " + [held.isNaN(NaN), method(NaN), method.call(null, 1), [NaN, 1].map(globalThis.Number.isNaN)].join(" "));
const withParameter = globalThis => globalThis.Number.isNaN(NaN);
said.push("a parameter named globalThis: " + withParameter({ Number: { isNaN: () => "the parameter's" } }));
{
  const globalThis = { Number: { isNaN: () => "the block's" } };
  said.push("a constant named globalThis: " + globalThis.Number.isNaN(NaN));
}
globalThis.mine = { isNaN: () => "the program's global" };
said.push("a global of the program: " + globalThis.mine.isNaN(NaN));
globalThis.mine = { isNaN: () => "replaced" };
said.push("replaced: " + globalThis.mine.isNaN(NaN));
said.push("absent: " + [typeof globalThis.NoSuchThing, globalThis.NoSuchThing?.isNaN, globalThis?.Number.isNaN(NaN), globalThis.Number?.isNaN(1)].join(" "));
globalThis.self = { Number: { isNaN: () => "another self" } };
said.push("self replaced: " + self.Number.isNaN(NaN));
const attempt = f => { try { return String(f()); } catch (error) { return error.constructor.name; } };
said.push("not a function: " + attempt(() => globalThis.Number.noSuchFunction(1)));
let sum = 0;
for (let i = 0; i < 20000; i++) sum += globalThis.Number.isSafeInteger(i % 3 ? i : i + 0.5) + globalThis.Number.isNaN(i % 5 ? i : NaN) * 2;
said.push("many: " + sum);
console.log(said.join("\n"));

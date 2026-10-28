// Text made at run time asks isNaN, isFinite, Number.isNaN, Number.isFinite, Number.isInteger, Number.isSafeInteger and Array.isArray about every kind of value, with no argument and with several.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);
class List extends Array {}
const revoked = Proxy.revocable([], {});
revoked.revoke();
const values = [
  0, -0, 1, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 9007199254740991, 9007199254740992, -9007199254740991, 0.5, -0.5, 1e21, 1e308, 5e-324, 1.7976931348623157e308,
  NaN, -NaN, Infinity, -Infinity, 0 / 0, Math.sqrt(-1), new Float64Array(new BigUint64Array([0x7ff8000000000001n, 0xfff8000000000000n, 0x7ff0000000000001n]).buffer)[0],
  undefined, null, true, false, "", "1", " 12 ", "x", "Infinity", "NaN", "0x10", [], [1], [1, 2], ["x"], [[]], new List(), new List(3), new Array(5), Object.freeze([1]), {}, { length: 0 }, { valueOf() { return 3; } }, { valueOf() { return NaN; } },
  new Number(1), new Number(NaN), new String("2"), new Date(0), new Date(NaN), () => 1, function () {}, /x/, new Map(), new Uint8Array(2), new Proxy([], {}), new Proxy({}, {}), new Proxy(new Proxy([1], {}), {}), Object.create(Array.prototype), arguments_(),
];
function arguments_() { return arguments; }
const throwing = [Symbol("s"), 1n, { valueOf() { throw new RangeError("no number"); } }, Object.create(null), revoked.proxy];
const names = ["isNaN", "isFinite", "Number.isNaN", "Number.isFinite", "Number.isInteger", "Number.isSafeInteger", "Array.isArray"];
for (const name of names) {
  const ask = text("values", `let out = ""; for (let round = 0; round < 3; round++) { out = ""; for (const value of values) out += ${name}(value) ? "1" : "0"; } return out`);
  console.log(name.padEnd(22), ask(values));
  const askThrowing = text("values", `const out = []; for (const value of values) { try { out.push(${name}(value)); } catch (error) { out.push(error.constructor.name); } } return out`);
  console.log(name.padEnd(22), askThrowing(throwing).join());
  console.log(name.padEnd(22), text(`return [${name}(), ${name}(1, "x"), ${name}(NaN, 1), ${name}("x", 1, 2, 3), ${name}.call(null, 2), ${name}.apply(null, [[]]), ${name}.length, ${name}.name]`)().join());
}
console.log(text("n", "let s = 0; for (let i = 0; i < n; i++) { const x = i % 3 ? i / 2 : i; if (!isNaN(x) && isFinite(x) && Number.isInteger(x) && !Array.isArray(x)) s++; } return s")(3000));

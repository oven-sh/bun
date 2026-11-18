globalThis.holes = a => { let s = a.length + "|"; for (let i = 0; i < a.length; i++) s += i < 6 || i > a.length - 3 ? (i in a ? show(a[i]) : "_") + "," : ""; return s; };
class Derived extends Array {}
const makers = `
  [1, 2, 3]; Array.of(1, 2, 3); [1.5, 2]; Array.of(0.5, -0); ["a", 1, null]; Array.of("a", "b" + String(1), 2n, NaN, undefined); []; new Array(2); [1, , 3]; [0.5, , 3];
  Object.setPrototypeOf([1, , 3], Object.setPrototypeOf({ 1: 4 }, Array.prototype)); Array.of(...Array(50).keys()); Object.freeze(Array.of(1, 2));
  Object.seal(Array.of(1, 2)); Object.defineProperty([1], "length", { writable: false }); Derived.of(1, 2); Object.assign([1, 2], { constructor: Derived });
  Object.assign([1], { 5000: 1, length: 9 }); Object.setPrototypeOf({ length: 1, 0: 1 }, Array.prototype);
  Object.setPrototypeOf((function () { return arguments })(1, 2), Array.prototype); new Proxy([1, 2], {})`.split(";").map(text => eval(`() => [${text}]`));
const arrays = lazily(makers, make => make());
globalThis.after = (result, a) => [Array.isArray(result) ? result.constructor.name + holes(result) : show(result), a.length > 99 ? a.length : holes(a)];
for (const call of [
  "push(4)", "push(4.5)", "push(NaN)", "push('v')", "push(4, 5)", "push(0.5, {})", "push(after.length)", "push(String(a.length))", "pop()", "shift()", "unshift(0)", "unshift('v')",
  "slice(1, 3)", "slice(-2)", "slice(2, 1)", "slice(undefined, 2)", "slice(0.5, 60)", "splice(1, 1)", "splice(0, 0, 0.5, 'v')", "splice(-1)", "splice(1, -1, 7)", "splice(0, undefined)",
]) check(`a => after(a.${call}, a)`, arrays);
check("a => [a.push(1), a.pop(), a.length]", () => [3, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1].map(length => [Object.assign([1], { length })]));
for (const needle of ["2", "49", "4", "0", "null", "'b1'", "2n", "NaN", "undefined"])
  check(`a => [a.indexOf(${needle}), a.includes(${needle}), a.indexOf(${needle}, 2), a.includes(${needle}, -2), a.indexOf(${needle}, 99), a.slice().length]`, arrays);
check("(a, x) => [a.indexOf(x), a.includes(x)]", () => values().map((x, _, all) => [all, x]).concat(values().map(x => [[0, 1, 7], x])));
check("a => Array.isArray(a)", () => values().concat([Array.prototype, Derived.of(1), new Proxy([], {}), new Proxy({}, {})]).map(a => [a]));
check("(n, v) => { const a = []; for (let i = 0; i < n; i++) a.push(i === 20 ? v : i); let s = ''; while (a.length) s += a.pop(); return s + a.pop(); }", () => [[9, 0], [40, 1], [40, 0.5], [40, "s"]]);
check("(a, change) => { const n = a.length; a.push(change(a)); return [n, holes(a)]; }", () => [a => 1, a => (a[0] = 0.5), a => (a.length = 0), a => Object.freeze(a).length, a => a.shift()].map(f => [Array.of(1, 2), f]));
check("function () { return holes(Array.prototype.slice.call(arguments, 1)); }", () => [[], [1], [1, 2, 3]]);

check("(a, f) => { const seen = []; a.forEach((x, i) => { seen.push(show(x)); if (!i) f(a); }); return seen; }", () =>
  [a => {}, a => (a[1] = 0.5), a => (a[1] = "s"), a => a.pop(), a => delete a[1], a => (a.length = 1)].map(f => [Array.of(1, 2, 3), f]));
for (const length of ["0", "1", "2", "5", "70", "200000", "-1", "1.5"])
  check(`a => { "use strict"; a.length = ${length}; a[1] = a[1]; return [a.length, a[0], a[1], a[2], 2 in a]; }`, arrays);
check("a => { const { length } = a; return [length, a['length']]; }", () => [[1], [0.5, 1], "abc", (function () { return arguments; })(1), { length: 4 }, Object.assign([], { length: 2 ** 32 - 1 })].map(a => [a]));

// What has been read from an array stays what it was, wherever the array keeps it afterwards.
for (const change of ["a.shift()", "a.unshift(0)", "a.splice(1, 2)", "a.length -= turn & 1", "a[a.length] = 0", "a.push(0)"]) {
  const tag = {}, step = (0, eval)(`tag => (a, turn) => { a[0] = 1; const named = a.x; ${change}; return named === tag; }`)(tag);
  const a = Object.assign(Array.of(...Array(900).keys()), { x: tag, y: {} });
  for (let turn = 0; turn < 250; turn++) if (a.shift(), !step(a, turn)) throw new Error(`${change}, turn ${turn}`);
}

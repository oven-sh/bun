const symbol = Symbol("s");
const join = (a, b) => [a, b].reduce((x, y) => x + y);
const more = () => [
  ...values(), false, 1023, 1024, "a", "b", "abc", "ሴ", join("a", "bc"), join("a", "bd"), "xabc".substring(1), 0n, -3n,
  symbol, Math.max, Array, new Proxy({}, {}), new Proxy(Math.max, {}), new String("a"), { valueOf: () => 3n },
];
const each = () => more().map(a => [a]);
const some = () => more().map((a, index, all) => [a, all[(index * 5 + 2) % all.length]]).concat(more().map(a => [a, a]));
const within = (...picks) => () => picks.flatMap(a => picks.map(b => [a(), b()]));

for (const op of ["+", "-", "*", "/", "%", "**", "&", "<<", ">>>", "<", ">=", "==", "==="]) {
  checkInTurn(`(a, b) => a ${op} b`, some, 8);
  checkInTurn(`(a, b) => (a ${op} b ? 1 : 2)`, within(() => 1, () => 0.5, () => undefined, () => true, () => null));
  checkInTurn(`(a, b) => a ${op} b`, within(() => "a", () => join("a", "b"), () => "ab", () => 7, () => undefined));
  checkInTurn(`(a, b) => a ${op} b`, within(() => 2n, () => -3n, () => 0n), 30);
}
for (const op of ["==", "===", "<", "<=", ">", ">="])
  for (const constant of ['"a"', '"abc"', '""', "0", "symbol"]) checkInTurn(`a => (a ${op} ${constant} ? 1 : 2)`, each, 8);
for (const body of [
  "(a ? 1 : 2)", "[a++, a]", "[a--, a]", "-a", "+a", "~a", "`${a}`", "`<${a}>`", "`${a}${a}${a}${a}`", '"" + a', "({ [a]: 1 })",
  "typeof a", "typeof a === 'object'", "typeof a === 'function' ? 1 : 2", "typeof a === 'undefined'", "a ** 3", "a ** 0",
  "{ const t = typeof a; return t === 'string' ? a.length : t === 'number' ? a + 1 : t === 'object' ? 0 : t === 'none' ? 1 : t; }",
  "{ switch (typeof a) { case 'number': return a + 1; case 'object': return a === null; case 'function': case 'none': return 2; } }",
  "{ switch (a) { case 0: return 1; case 1: return 2; case 7: return 3; case -1: return 4; } }",
  "{ switch (a) { case 'a': return 1; case 'b': return 2; case '7': return 3; case '\\u1234': return 4; } }",
  "{ switch (a) { case 'a': return 1; case 'abc': return 2; case '': return 3; case 'abc': return 4; } }",
  "(function () { return typeof this + (this === globalThis); }).call(a)",
  "Array.prototype.map.call(a, x => x)",
  "(a.length ? [a[0] === 'a', a[0] < 'b'] : 0)",
]) {
  check(`a => ${body}`, each);
  checkInTurn(`a => ${body}`, each);
}
check((a, b) => typeof a === typeof b, some);
check((a, b) => `${a}-${b}`, some);
check(a => { let s = ""; for (let i = 0; i < 40; i++) s += a + i; return s; }, () => [[""], ["ሴ"], [1], [null]]);
check(a => { let s = "ab"; for (let i = 0; i < a; i++) s += s; return s.length; }, () => [[3], [29], [31]]);
check(a => { let s = "ab"; for (let i = 0; i < a; i++) s = `${s}${s}${s}`; return s.length; }, () => [[3], [18], [20]]);
checkInTurn(a => [a <= "a", a >= "a", "a" < a], () => [[""], ["a"], ["ab"], ["b"], [join("a", "b")]], 40);
checkInTurn((a, b) => { const same = a === b; return same ? [same] : same; }, some);
checkInTurn(a => { switch (typeof a) { case "number": return 1; default: return typeof a === "number" || a === null; } }, each);
checkInTurn(
  (a, b) => { const step = (o, c) => { let v = o.v; return c ? v++ : 7; }, o = { v: a }; return step({ v: true }, 1) + o.v * 1.5 + step(o, b); },
  () => [...Array(60).keys()].map(i => [i, i & 1]).concat([[2.5, 1]]), 4,
);
checkInTurn(
  (a, b, c, d) => { let v = c ? a + b : true; const r = d ? v++ : 7; return r + v; },
  () => [[2147483647, 5, true, false], [1, 2, false, true], [1, 2, true, true], [2147483647, 5, true, true]], 80,
);

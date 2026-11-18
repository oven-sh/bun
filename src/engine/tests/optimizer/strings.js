const positions = () => [1, 0, -2, 9, 1.5, -0.5, NaN, Infinity, -Infinity, 2 ** 32 + 1, undefined, null, "1", { valueOf: () => 2 }];
for (const name of ["at", "charAt", "charCodeAt", "codePointAt", "slice", "substring", "substr"]) check(`(s, i) => s.${name}(i)`, across(strings, positions));
for (const name of ["slice", "substring", "substr"]) check(`(s, i) => [s.${name}(1, i), s.${name}(i, 4), s.${name}()]`, across(strings, positions));
checkInTurn((s, a, b) => [s.slice(a, b), s.substring(a, b), s.endsWith("c", b), s.lastIndexOf("a", b)], () => [["abcabc", 1, 3], ["abcabc", undefined, undefined], ["abcabc", 2, 4.5]], 150);
check((s, i) => [s.slice(1).slice(i, -1), s.substring(i).substr(1, 3), s.slice(i, i + 1), s.slice(i, i + 2), s.slice(i, i + 3).slice(1)], across(strings, () => [1, 0, 3]));
check((s, i) => [s.at(i)?.charCodeAt(0), s.charAt(i).length, s.charAt(i).codePointAt(0), s.charCodeAt(i)], across(strings, () => [1, 0, -1, 7]));
for (const same of ["s.toLowerCase()", "s.toWellFormed()", "escape(s)", "decodeURI(s)", "s.replaceAll('?', '')"]) check(`s => ${same}.charCodeAt(1)`, oneOf(strings));
check((s, i) => s.codePointAt(i), across(() => ["\ud83d\ude00", "a\ud83d", "\ud83dz", "\ude00\ud83d\ude00", inside("\ud83d", "\ude00\ude00")], () => [0, 1, 2]));
const alphabet = "abcdefghijklmnopq";
for (const count of [1, 2, 3, 4, 7, 8, 9, 16, 17]) {
  const part = alphabet.slice(0, count), near = at => part.slice(0, at) + "?" + part.slice(at + 1);
  check(`s => [s.startsWith("${part}"), s.endsWith("${part}"), s.startsWith("${part}", 1), s.endsWith("${part}", s.length - 1)]`,
    oneOf(() => [part, near(0), near(count - 1), near(count >> 1), part.slice(1), `-${part}-`, inside(part, part), inside(part, "\u65e5"), joined(part, part)]));
}
// What a part of a string is of stays alive while only the part has it.
check(make => { let whole = make(); const parts = [whole.slice(1, 4), whole.substring(2), whole.slice(0, 2)];
  whole = null; const junk = []; for (let i = 0; i < 200; i++) junk.push({ i, s: "x" + i });
  return [parts.map(it => it + "!"), parts.map(it => it.length), junk.length]; },
  oneOf(() => [() => inside("abcdefgh", "xy"), () => joined("abcd", "efgh"), () => "abcdefgh".slice(0)]));

check(s => [s.trim(), s.trimStart(), s.trimEnd()], oneOf(() => ["!~", " a", "a\t", "\u00a0a", "a\u00a0", "\u009fa\u00a1", "\u2003a", inside("a", "  "), inside(" a ", "bc")]));
check((a, b) => ["x".concat(a), "x".concat(a, b, a, b), "".concat(), String.prototype.concat.call(a, b), "a" + "b" + a + "c" + "d"],
  across(() => ["p", 1, 0.5, null, 2n, new String("w"), Object.assign(new String("w"), { toString: () => "own" }), Symbol.iterator], () => ["q", new String("v")]));
check(s => { const it = s[Symbol.iterator](), all = []; for (let step; !(step = it.next()).done; ) all.push(step.value); return [all, it.next()]; }, oneOf(strings));
for (const name of ["indexOf", "lastIndexOf", "includes", "startsWith", "endsWith"]) {
  check(`(s, i) => [s.${name}("c", i), s.${name}("ab", i), s.${name}("b"), s.${name}("")]`, across(strings, positions));
  check(`(s, t) => s.${name}(t)`, across(strings, stringlike));
}
for (const name of ["trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "isWellFormed", "toWellFormed", "valueOf"])
  check(`s => String.prototype.${name}.call(s)`, () => oneOf(stringlike)().concat([[new String("o")]]));
for (const name of ["repeat", "padStart", "padEnd"]) check(`(s, n) => s.${name}(n, "-")`, across(strings, () => [2, 0, 8, -1, 1.5, undefined]));
for (const name of ["concat", "localeCompare", "split", "match", "search"]) check(`(s, t) => s.${name}(t)`, across(strings, stringlike));
check((s, t) => [s.replace("b", t), s.replaceAll("b", t), s.replace("b", "x"), s.replace("b", "$&$&"), s.replaceAll("", "-")], across(strings, () => ["x", "$'", joined("$", "`"), 1]));
check(a => [Symbol(a) === Symbol(a), Symbol(a).toString(), Symbol.for(a) === Symbol.for(a), Symbol().description], oneOf(stringlike));
check(s => [new String(s) !== new String(s), new String(s).length], oneOf(stringlike));
for (const name of ["JSON.parse", "JSON.stringify", "decodeURIComponent", "decodeURI", "encodeURIComponent", "encodeURI", "escape", "unescape"])
  check(`s => ${name}(s)`, () => [["1"], ['{"a":[1]}'], ["%41"], ["%"], ["\ud800"], [joined("%4", "1")], [7]]);

check(s => [other.String.prototype.split.call(s, "b") instanceof other.Array, new other.String(s) instanceof other.String, other.JSON.parse("[]") instanceof Array], oneOf(strings));

// What throws has the built-in in its stack trace, and has happened once.
check((s, log) => { log.push(1); try { return [JSON.parse(s), log]; } catch (error) { return [error.stack.split("@")[0], log]; } }, () => [["1", []], ["[", []]]);
check(s => { "use strict"; const inner = () => decodeURIComponent(s); try { return inner(); } catch (error) { return error.stack.split("@")[0]; } }, () => [["a"], ["%"]]);

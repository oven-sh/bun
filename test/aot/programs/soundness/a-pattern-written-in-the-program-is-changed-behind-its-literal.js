// A pattern written in the program is changed behind its literal.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
const re = /a/; re.compile("b");
console.log(re.test("a"), re.test("b"), "ab".replace(re, "-"), re.source);
const r2 = /a/g; r2.exec = function () { return null; };
console.log("aaa".replace(r2, "-"), "aaa".match(r2), r2.test("a"));
const r4 = /a/; r4[Symbol.replace] = () => "mine"; r4[Symbol.match] = false;
console.log("aaa".replace(r4, "-"), attempt(() => "/a/".startsWith(r4)), attempt(() => "x/a/".includes(r4)));
const r5 = /a/g; Object.defineProperty(r5, "lastIndex", { value: 1, writable: false });
console.log(attempt(() => r5.test("aaa")), attempt(() => "aaa".replace(r5, "-")), r5.lastIndex);
const r6 = /,/; r6.constructor = { [Symbol.species]: function (p, f) { return { exec() { return null; }, lastIndex: 0 }; } };
console.log("a,b".split(r6).length, [..."a,b".matchAll(/,/g)].length);
const r7 = /a/y; r7.lastIndex = { valueOf() { seen.push("valueOf"); return 1; } };
console.log(r7.test("ba"), seen.join(), r7.lastIndex);
function fresh() { return /a/g; }
const f1 = fresh(), f2 = fresh(); f1.lastIndex = 2; console.log(f1 === f2, f2.lastIndex, f1.test("aaa"), f2.test("aaa"), f1.lastIndex, f2.lastIndex);
Object.setPrototypeOf(f2, { test() { return "other"; }, __proto__: RegExp.prototype });
console.log(f2.test("a"), f1.test("a"));

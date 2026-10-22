// What an object has of its own from its creation and nobody wrote: the length of an array, the length and name of a function, lastIndex of a regular expression, cause of an error, the characters and the length of a text ..
// Each kind is asked through a descriptor, each question in a function of its own: the value goes into a field, and the field is asked for its type. With a number as argument only that case runs.
function case0() {
  const found = Object.getOwnPropertyDescriptor([1, 2, 3], "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('array literal length', typeof holder.held);
}
function case1() {
  const found = Object.getOwnPropertyDescriptor([], "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('empty array length', typeof holder.held);
}
function case2() {
  const found = Object.getOwnPropertyDescriptor([7, 8], "1");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('array element', typeof holder.held);
}
function case3() {
  const found = Object.getOwnPropertyDescriptor([7, 8], 0);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('array element by number', typeof holder.held);
}
function case4() {
  const found = Object.getOwnPropertyDescriptor(new Array(4), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('new Array length', typeof holder.held);
}
function case5() {
  const found = Object.getOwnPropertyDescriptor(Array.of(1, 2), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Array.of length', typeof holder.held);
}
function case6() {
  const found = Object.getOwnPropertyDescriptor([1, 2].map(x => x + 1), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('mapped array length', typeof holder.held);
}
function case7() {
  const found = Object.getOwnPropertyDescriptor(function (a, b) {}, "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('function length', typeof holder.held);
}
function case8() {
  const found = Object.getOwnPropertyDescriptor(function named() {}, "name");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('function name', typeof holder.held);
}
function case9() {
  const found = Object.getOwnPropertyDescriptor(function made() {}, "prototype");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('function prototype', typeof holder.held);
}
function case10() {
  const found = Object.getOwnPropertyDescriptor((a => a), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('arrow length', typeof holder.held);
}
function case11() {
  const found = Object.getOwnPropertyDescriptor((() => 1), "name");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('arrow name', typeof holder.held);
}
function case12() {
  const found = Object.getOwnPropertyDescriptor(class { constructor(a) {} }, "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('class length', typeof holder.held);
}
function case13() {
  const found = Object.getOwnPropertyDescriptor(class Named {}, "name");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('class name', typeof holder.held);
}
function case14() {
  const found = Object.getOwnPropertyDescriptor(class Made {}, "prototype");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('class prototype', typeof holder.held);
}
function case15() {
  const found = Object.getOwnPropertyDescriptor((class Made {}).prototype, "constructor");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('prototype constructor', typeof holder.held);
}
function case16() {
  const found = Object.getOwnPropertyDescriptor(({ method() {} }).method, "name");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('method name', typeof holder.held);
}
function case17() {
  const found = Object.getOwnPropertyDescriptor(async function (a) {}, "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('async function length', typeof holder.held);
}
function case18() {
  const found = Object.getOwnPropertyDescriptor(function* () {}, "prototype");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('generator function prototype', typeof holder.held);
}
function case19() {
  const found = Object.getOwnPropertyDescriptor((function (a, b) {}).bind(null, 1), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('bound length', typeof holder.held);
}
function case20() {
  const found = Object.getOwnPropertyDescriptor((function named() {}).bind(null), "name");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('bound name', typeof holder.held);
}
function case21() {
  const found = Object.getOwnPropertyDescriptor(new Error("said"), "message");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('error message', typeof holder.held);
}
function case22() {
  const found = Object.getOwnPropertyDescriptor(new Error("said"), "stack");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('error stack', typeof holder.held);
}
function case23() {
  const found = Object.getOwnPropertyDescriptor(new Error("said", { cause: 5 }), "cause");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('error cause', typeof holder.held);
}
function case24() {
  const found = Object.getOwnPropertyDescriptor(new TypeError("said"), "message");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('type error message', typeof holder.held);
}
function case25() {
  const found = Object.getOwnPropertyDescriptor(new AggregateError([1], "said"), "errors");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('aggregate errors', typeof holder.held);
}
function case26() {
  const found = Object.getOwnPropertyDescriptor(/a/g, "lastIndex");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('regexp lastIndex', typeof holder.held);
}
function case27() {
  const found = Object.getOwnPropertyDescriptor(new RegExp("a"), "lastIndex");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('new RegExp lastIndex', typeof holder.held);
}
function case28() {
  const found = Object.getOwnPropertyDescriptor(new String("abc"), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('String object length', typeof holder.held);
}
function case29() {
  const found = Object.getOwnPropertyDescriptor(new String("abc"), "1");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('String object character', typeof holder.held);
}
function case30() {
  const found = Object.getOwnPropertyDescriptor(new Uint8Array([5, 6]), "1");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('typed array element', typeof holder.held);
}
function case31() {
  const found = Object.getOwnPropertyDescriptor("abc".match(/b/), "index");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('match index', typeof holder.held);
}
function case32() {
  const found = Object.getOwnPropertyDescriptor("abc".match(/b/), "input");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('match input', typeof holder.held);
}
function case33() {
  const found = Object.getOwnPropertyDescriptor("abc".match(/(?<g>b)/), "groups");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('match groups', typeof holder.held);
}
function case34() {
  const found = Object.getOwnPropertyDescriptor("a,b".split(","), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('split length', typeof holder.held);
}
function case35() {
  const found = Object.getOwnPropertyDescriptor((s => s)`x`, "raw");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('template raw', typeof holder.held);
}
function case36() {
  const found = Object.getOwnPropertyDescriptor((s => s)`x${1}y`, "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('template length', typeof holder.held);
}
function case37() {
  const found = Object.getOwnPropertyDescriptor([1][Symbol.iterator]().next(), "value");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('iterator result value', typeof holder.held);
}
function case38() {
  const found = Object.getOwnPropertyDescriptor([1][Symbol.iterator]().next(), "done");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('iterator result done', typeof holder.held);
}
function case39() {
  const found = Object.getOwnPropertyDescriptor(Object.entries({ a: 1 })[0], "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('entries pair', typeof holder.held);
}
function case40() {
  const found = Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor({ a: 1 }, "a"), "writable");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('descriptor of a descriptor', typeof holder.held);
}
function case41() {
  const found = Object.getOwnPropertyDescriptor(({ kept: 1 }), "kept");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('literal field', typeof holder.held);
}
function case42() {
  const found = Object.getOwnPropertyDescriptor(new (class { kept = 1 })(), "kept");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('instance field', typeof holder.held);
}
function case43() {
  const found = Object.getOwnPropertyDescriptor(JSON.parse('{"a":1}'), "a");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('JSON.parse field', typeof holder.held);
}
function case44() {
  const found = Object.getOwnPropertyDescriptor(Object.assign({}, { a: 1 }), "a");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Object.assign field', typeof holder.held);
}
function case45() {
  const found = Object.getOwnPropertyDescriptor(({ ...{ a: 1 } }), "a");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('spread field', typeof holder.held);
}
function case46() {
  const found = Object.getOwnPropertyDescriptor(((...rest) => rest)(1, 2), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('rest array length', typeof holder.held);
}
function case47() {
  const found = Object.getOwnPropertyDescriptor((function () { return arguments; })(1, 2), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('sloppy arguments length', typeof holder.held);
}
function case48() {
  const found = Object.getOwnPropertyDescriptor((function () { return arguments; })(1, 2), "0");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('arguments element', typeof holder.held);
}
function case49() {
  const found = Object.getOwnPropertyDescriptor(Promise.withResolvers(), "resolve");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Promise.withResolvers resolve', typeof holder.held);
}
function case50() {
  const found = Object.getOwnPropertyDescriptor(Proxy.revocable({}, {}), "revoke");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Proxy.revocable revoke', typeof holder.held);
}
function case51() {
  const found = Object.getOwnPropertyDescriptor(Object.groupBy([1], () => 'g'), "g");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Object.groupBy group', typeof holder.held);
}
function case52() {
  const found = Object.getOwnPropertyDescriptor(Object.fromEntries([['a', 1]]), "a");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Object.fromEntries field', typeof holder.held);
}
function case53() {
  const found = Object.getOwnPropertyDescriptor(structuredClone({ a: 1 }), "a");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('structuredClone field', typeof holder.held);
}
function case54() {
  const found = Object.getOwnPropertyDescriptor(new Intl.NumberFormat('en').resolvedOptions(), "locale");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('Intl resolved locale', typeof holder.held);
}
function case55() {
  const found = Object.getOwnPropertyDescriptor(new Map([[1, 2]]), "size");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('URLSearchParams none', typeof holder.held);
}
function case56() {
  const found = Object.getOwnPropertyDescriptor("text", 1);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('a character of a text', typeof holder.held, holder.held);
}
function case57() {
  const found = Object.getOwnPropertyDescriptor("text", "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('the length of a text', typeof holder.held, holder.held);
}
function case58() {
  const found = Object.getOwnPropertyDescriptor("text", 9);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('behind the end of a text', typeof holder.held, holder.held);
}
function case59() {
  const found = Object.getOwnPropertyDescriptor("text", "missing");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('a name that a text does not have', typeof holder.held, holder.held);
}
function case60() {
  const found = Object.getOwnPropertyDescriptor(new String("text"), 2);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('a character of a String object', typeof holder.held, holder.held);
}
function case61() {
  const found = Object.getOwnPropertyDescriptor(new String("text"), "length");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('the length of a String object', typeof holder.held, holder.held);
}
function case62() {
  const found = Object.getOwnPropertyDescriptor(`${process.argv.length}text`, 0);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('a character of a text made at run time', typeof holder.held, holder.held);
}
function case63() {
  const found = Object.getOwnPropertyDescriptor(process.argv.length > 99 ? { 0: 5 } : "text", 0);
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('a text or an object', typeof holder.held, holder.held);
}
const cases = [case0, case1, case2, case3, case4, case5, case6, case7, case8, case9, case10, case11, case12, case13, case14, case15, case16, case17, case18, case19, case20, case21, case22, case23, case24, case25, case26, case27, case28, case29, case30, case31, case32, case33, case34, case35, case36, case37, case38, case39, case40, case41, case42, case43, case44, case45, case46, case47, case48, case49, case50, case51, case52, case53, case54, case55, case56, case57, case58, case59, case60, case61, case62, case63];
const chosen = process.argv[2];
if (chosen === undefined) for (const each of cases) each();
else cases[Number(chosen)]();

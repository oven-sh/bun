// `{}.hasOwnProperty`, `{}.toString`, `[].slice`: as many packages get at the methods of Object.prototype and Array.prototype: called at once with `.call` and `.apply`, kept in variables, compared, and beside literals that are not empty after all.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
interface T { a?: number; b: number }
const hasOwn = {}.hasOwnProperty, toText = {}.toString, slice = [].slice, join = [].join;
function atOnce(o: any, k: any) { return {}.hasOwnProperty.call(o, k); }
function kept(o: any, k: any) { return hasOwn.call(o, k); }
function inParentheses(o: any, k: any) { return ({}).hasOwnProperty.call(o, k); }
function offAnArray(o: any, k: any) { return [].hasOwnProperty.call(o, k); }
function long(o: any, k: any) { return Object.prototype.hasOwnProperty.call(o, k); }
function tag(x: any) { return [{}.toString.call(x), toText.call(x), Object.prototype.toString.call(x)].join(); }
function rest(..._all: unknown[]) { return [].slice.call(arguments, 1); }
function restKept(..._all: unknown[]) { return slice.call(arguments, 1); }
function joined(..._all: unknown[]) { return [[].join.call(arguments, "-"), join.call(arguments, "+")]; }
function classNames(...list: any[]) { const classes: string[] = []; for (const arg of list) { if (!arg) continue; if (typeof arg === "string" || typeof arg === "number") classes.push(String(arg)); else if (Array.isArray(arg)) { const inner = classNames.apply(null, arg); if (inner) classes.push(inner); } else if (typeof arg === "object") { for (const key in arg) if (hasOwn.call(arg, key) && arg[key]) classes.push(key); } } return classes.join(" "); }
const say = (make: () => unknown) => { try { return JSON.stringify(make()); } catch (e) { return (e as Error).name; } };
const typed: T = { a: 1, b: 2 }, partly: T = { b: 2 };
const child = Object.create({ inherited: 1 }); child.own = 1;
const receivers: unknown[] = [JSON.parse('{"a":1,"0":2}'), typed, partly, child, [1, , 3], "ab", 5, function f() {}, Object.create(null), null, undefined];
const keys: unknown[] = ["a", "b", "own", "inherited", "length", "0", 1, Symbol.iterator, "hasOwnProperty"];
for (const o of receivers) {
  const rows = [atOnce, kept, inParentheses, offAnArray, long].map(f => keys.map(k => { const said = say(() => f(o, k)); return said === "true" ? "1" : said === "false" ? "0" : "T"; }).join(""));
  console.log(rows[0], rows.every(row => row === rows[0]));
}
console.log([1, "s", null, undefined, [], {}, () => 1, new Date(0), /x/, typed, Symbol.iterator, 1n, new Map(), (function () { return arguments; })()].map(tag).join(" "));
console.log(say(() => rest(1, 2, 3)), say(() => restKept(1, 2, 3)), say(() => rest()), say(() => slice.call("abc", 1)), say(() => [].slice.call({ length: 2, 0: "a", 1: "b" })), say(() => joined(1, "b", null)));
console.log(say(() => [].concat.apply([], [[1], [2, 3], 4] as any)), say(() => { const list = [0]; [].push.apply(list, [1, 2] as any); return list; }), say(() => [].map.call("ab", (c: any) => c + c)), say(() => [].indexOf.call("abc", "c" as never)), say(() => { const seen: unknown[] = []; [].forEach.call({ length: 2, 0: "x", 1: "y" }, (v: unknown, i: number) => seen.push(i, v)); return seen; }), say(() => [].filter.call([1, 2, 3, 4], (n: any) => n % 2 === 0)));
console.log({}.hasOwnProperty === Object.prototype.hasOwnProperty, hasOwn === Object.prototype.hasOwnProperty, [].hasOwnProperty === hasOwn, [].slice === Array.prototype.slice, slice === Array.prototype.slice, ({}).toString === ([] as any).toString, toText === Object.prototype.toString, {}.constructor === Object, [].constructor === Array, [].length, ({} as any).missing, ([] as any).missing, typeof {}.valueOf, {}.hasOwnProperty.name, [].slice.length);
console.log(say(() => ({ hasOwnProperty() { return "mine"; } }).hasOwnProperty()), say(() => ({ toString() { return "told"; } }).toString()), say(() => { const shadow = { hasOwnProperty(this: unknown, k: string) { return "own " + k; } }.hasOwnProperty; return shadow.call(null, "k"); }), say(() => [1, 2].slice.call([3, 4, 5], 1)), say(() => ({ a: 1 }).hasOwnProperty("a")), say(() => [7].hasOwnProperty(0)), say(() => ({}).hasOwnProperty("a")), say(() => [].hasOwnProperty("length")));
console.log(say(() => { const o: any = {}; const f = o.hasOwnProperty; o.x = 1; return [f.call(o, "x"), f.call(o, "y"), f === hasOwn]; }), say(() => { const o: any = {}; o.hasOwnProperty = () => "set"; return o.hasOwnProperty("x"); }), say(() => { const list: any = []; list.slice = () => "set"; return list.slice(); }));
console.log(classNames("a", { b: true, c: false, d: 1 }, ["e", { f: typed }], typed, partly, child, 0, null, 7));
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? (counted("operationAOTHasOwnByIdAndCache") + counted("operationAOTHasOwnByValAndCache")) : 0;
const fresh: { q1: number; q2?: number } = { q1: 1 }, other: { r1: number; r2?: number } = { r1: 1 };
const things: any[] = [fresh, JSON.parse('{"q1":1,"q9":2}')], others: any[] = [other, JSON.parse('{"r1":1,"r9":2}')], names = ["q1", "q2", "q3", "q9"], more = ["r1", "r2", "r3", "r9"];
let before = entered(), total = 0;
for (let i = 0; i < 3000; i++) total += +atOnce(things[i & 1], names[i % 4]);
const first = entered() - before;
before = entered();
for (let i = 0; i < 3000; i++) total += +kept(others[i & 1], more[i % 4]);
const second = entered() - before;
console.log(total, counted ? first > 0 && first < 100 && second > 0 && second < 100 : true);

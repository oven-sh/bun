// `f(...list)` where nobody knows f: the list was copied into a new one and the call took the copy. The call takes the list itself: what the callee does with its arguments, its rest list or the list never shows in the other.
// STATISTIC: SpreadCallArrayCopiesElided >= 3
type Fn = (...args: any[]) => any;
const seen: string[] = [];
let shared: any[] = [];
const callees: Fn[] = [
  (a, b) => a + "|" + b,
  (...rest) => { rest.push("more"); rest[0] = "changed"; return rest.join(); },
  function () { arguments[0] = "written"; arguments.length = 1; return Array.prototype.join.call(arguments); },
  (a, b, c) => { shared.length = 0; shared.push("emptied"); return [a, b, c].join(); },
  (a, b, c, d, e, f) => [f, e, d, c, b, a].join(),
  function (this: any) { return this === undefined ? "no this" : typeof this; },
];
function callEach(list: any[]) { for (let i = 0; i < callees.length; i++) seen.push(String(callees[i](...list)) + " < " + list.join() + " " + list.length); }
function inTailPosition(f: Fn, list: any[]) { return f(...list); }
function behindOthers(f: Fn, list: any[]) { return f("first", ...list); }
function inFrontOfOthers(f: Fn, list: any[]) { return f(...list, "last"); }
function twice(f: Fn, list: any[]) { return f(...list, ...list); }
const holes = [1, , 3]; const doubles = [0.5, 1.5, , 2.5]; const texts = ["a", "b"]; const none: any[] = []; const six = [1, 2, 3, 4, 5, 6]; const mixed: any[] = [1, "two", 3.5, null, undefined, { toString() { return "object"; } }, 7];
for (const list of [holes, doubles, texts, none, six, mixed]) callEach(list);
shared = ["x", "y", "z"]; callEach(shared); seen.push(shared.join());
const long: number[] = []; for (let i = 0; i < 5000; i++) long.push(i);
seen.push(String(inTailPosition((...rest) => rest.length + " " + rest[4999], long)), String(inTailPosition(Math.max, long)));
for (const f of callees) seen.push(String(inTailPosition(f, texts)), String(behindOthers(f, texts)), String(inFrontOfOthers(f, texts)), String(twice(f, texts)));
console.log(seen.join("\n"));

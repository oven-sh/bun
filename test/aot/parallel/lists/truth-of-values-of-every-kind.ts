// Truth tests of values of every kind: what library functions test, and what callbacks answer.
const emptied = "abc".slice(3), cut = "xyz".substring(1, 2), joined = ["", ""].join(""), grown = emptied + "q", rope = "ab".repeat(20) + cut, wide = "Ā".slice(0, 0), repeated = "k".repeat(0);
const kinds: any[] = [
  "a", "", emptied, joined, cut, grown, rope, wide, repeated, `${""}`, String(""), "false", "0", "\0",
  0, 1, -0, -1, 2 ** 31, -(2 ** 31), 2 ** 53, 0.5, -0.5, NaN, Infinity, 5e-324,
  0n, 1n, -1n, 2n ** 70n, BigInt(0), null, undefined, true, false,
  Symbol(), Symbol.iterator, {}, [], () => 0, /x/, new Date(0), new String(""), new Number(0), new Boolean(false), Object(0n), new Proxy({}, {}), new Map(), Object.create(null), class { }, new (class A { })(),
];
const show = (value: any) => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value));
function rotated(by: number): any[] { const list: any[] = []; for (let k = 0; k < kinds.length; k++) list.push(kinds[(k + by) % kinds.length]); return list; }
function truthy(list: any[]) { return list.filter(Boolean); }
function kept(list: any[], test: (value: any) => any) { return list.filter(test); }
let turns = 0;
for (let round = 0; round < 60; round++) {
  const list = rotated(round);
  const byBuiltin = truthy(list);
  const byItself = list.filter(value => value);
  const byCall = kept(list, value => value);
  let byTest = 0, byNot = 0, byChoice = 0, byAnd = 0, byOr = 0;
  for (const value of list) {
    if (value) byTest++;
    if (!value) byNot++;
    byChoice += value ? 1 : 1000;
    if (value && turns >= 0) byAnd++;
    if (value || turns < 0) byOr++;
  }
  const some = list.some(value => value), every = list.every(value => value), found = list.find(value => !value), at = list.findIndex(value => value), last = list.findLast(value => value), lastAt = list.findLastIndex(value => !value);
  const answers = [byBuiltin.length, byItself.length, byCall.length, byTest, byNot, byChoice, byAnd, byOr, some, every, show(found), at, show(last), lastAt];
  if (round < 3 || round === 59) console.log(round, answers.join(" "), byBuiltin.map(show).join(","));
  turns += byBuiltin.length;
}
// Lists of one kind, with a hole, sparse, frozen, a subclass, one that changes while it is visited.
const strings = ["", "a", emptied, "b", "", "c"], whole = [0, 1, 2, 0, -0, 3], fractions = [0.5, 0, NaN, -0, 2.5, Infinity], holes = [, 1, , "x", ""], sparse: any[] = []; sparse[5] = 1; sparse[900] = "";
class Sub extends Array<any> { }
const sub = Sub.from(["", 1, "z", 0]);
function all(list: any[]) { let count = 0; for (let k = 0; k < 40; k++) count += list.filter(Boolean).length; return count; }
console.log(all(strings), all(whole), all(fractions), all(holes as any[]), all(sparse), all(Object.freeze(["", 0, 1, "y"]) as any), all(sub), sub.filter(Boolean) instanceof Sub);
const shrinking: any[] = ["", "a", 0, 1, "b"];
console.log(shrinking.filter(value => { if (value === "a") shrinking.length = 3; return value; }).join());
const becoming: any[] = [1, 0, 2];
console.log(becoming.filter((value, k) => { if (k === 0) becoming[1] = "now"; if (k === 1) becoming[2] = 0.5; return value; }).join());
try { strings.filter((value: any, k) => { if (k === 3) throw new Error("stop"); return value; }); } catch (error: any) { console.log(error.message); }
console.log(Array.prototype.filter.call("a b", Boolean).length, Array.prototype.filter.call({ length: 3, 0: "", 1: "x", 2: 0n }, Boolean).length, Array.from([0, 1, ""], Boolean).join(), [0, "", "a", 0n].map(Boolean).join());

// [...list.keys()], Array.from(list.keys()) and their kin over lists of every kind, iterators half stepped, changed prototypes of iterators.
const lines: string[] = [];
const say = (name: string, v: any) => lines.push(name + " " + JSON.stringify(v) + (Array.isArray(v) ? v.length : ""));
const sparse: any[] = []; sparse[5] = 1; const long: any[] = new Array(40); const doubles = [1.5, 2.5]; const none: any[] = []; const texts = ["a", "b", "c"];
const lists: [string, any[]][] = [["sparse", sparse], ["long", long], ["doubles", doubles], ["none", none], ["texts", texts], ["sized", Array(3)], ["frozen", Object.freeze([1, 2]) as any], ["big", new Array(3000)]];
function spread(list: any[]) { return [...list.keys()]; }
function between(list: any[]) { return ["x", ...list.keys(), 1.5, ...list.keys()]; }
function ints(list: any[]) { return [7, 8, ...list.keys()]; }
function from(list: any[]) { return Array.from(list.keys()); }
function mapped(list: any[]) { return Array.from(list.keys(), i => i * 2); }
function pushed(list: any[]) { const r: any[] = []; r.push(...list.keys()); return r; }
function stepped(list: any[]) { const it = list.keys(); it.next(); return [...it]; }
function twice(list: any[]) { const it = list.keys(); return [[...it].length, [...it].length, it.next().done]; }
function range(n: number) { return [...Array(n).keys()]; }
for (let t = 0; t < 3; t++) {
  for (const [name, list] of lists) for (const f of [spread, between, ints, from, mapped, pushed, stepped, twice]) { const r: any = f(list); say(name + " " + f.name, r.length > 20 ? [r.length, r[0], r[r.length - 1], r.reduce((a: any, b: any) => a + (typeof b === "number" ? b : 1), 0)] : r); }
  say("range", [range(0), range(4), range(1).length, range(100).length]);
  const r = range(4); r.push(9); r[1] = 5; (r as any)[6] = "s"; say("changed", r);
  const own: any = [1, 2, 3].keys(); own[Symbol.iterator] = function* () { yield "own"; }; say("own iterator", [...own]);
  const other: any = [1, 2, 3].keys(); other.next = () => ({ done: true, value: undefined }); say("own next", [...other]);
  const under: any = Object.setPrototypeOf([1, 2].keys(), { [Symbol.iterator]() { return ["p"][Symbol.iterator](); } }); say("prototype", [...under]);
}
for (const line of lines) console.log(line);

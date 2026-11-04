// Constant data is made anew by each evaluation, however it is made: objects, lists, trees, sets and maps of constants, at the top of a module, in functions and in loops. What one evaluation made is changed, and the next is as it is written.
function report(value: unknown): void { console.log(typeof value === "string" ? JSON.stringify(value) : String(value)); }
function show(value: any): string { return JSON.stringify(value, (_, v) => v instanceof Set ? ["set", ...v] : v instanceof Map ? ["map", ...v] : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v === "number" && v !== v ? "NaN" : v); }
function point() { return { kind: "point", x: 0, y: 0 }; }
const first = point();
const second = point();
report(first === second);
first.x = 5;
(first as any).extra = 1;
delete (first as any).kind;
report(show(first) + show(second) + show(point()));
function box() { return { kind: "box", size: { w: 1, h: 2 }, tags: ["a", "b"], none: null, gone: undefined, on: true, big: 10n, low: -0, odd: NaN, far: 1e300, half: 0.5 }; }
const boxes = [box(), box()];
report(boxes[0].size === boxes[1].size);
report(boxes[0].tags === boxes[1].tags);
boxes[0].size.w = 9;
boxes[0].tags.push("c");
boxes[0].tags[0] = "z";
report(show(boxes) + show(box()));
report(Object.keys(box()).join() + "|" + Object.getOwnPropertyNames(box().size).join());
report(JSON.stringify(Object.getOwnPropertyDescriptor(point(), "x")));
report(Object.getPrototypeOf(point()) === Object.prototype && Object.isExtensible(point()) && !Object.isFrozen(point()));
function list() { return [1, 2, 3]; }
const lists = [list(), list()];
report(lists[0] === lists[1]);
lists[0].push(4);
lists[0][0] = 1.5;
lists[1].length = 1;
report(show(lists) + show(list()));
function texts() { return ["a", "b"]; }
const someTexts = texts();
someTexts.reverse();
report(show(someTexts) + show(texts()));
function nested() { return [[1, 2], [3, [4, 5]], []]; }
const nest = nested();
(nest[1][1] as number[]).push(6);
(nest[2] as number[]).push(7);
report(show(nest) + show(nested()) + (nested()[0] === nested()[0]));
function holes() { return [1, , 3, , ]; }
report(holes().length + "," + (1 in holes()) + "," + show(holes()));
function keyed() { return { 2: "two", b: 1, 1: "one", a: 2, "-1": 3, "01": 4 }; }
report(Object.keys(keyed()).join() + show(keyed()));
function proto() { return { __proto__: null, a: 1 } as any; }
report(Object.getPrototypeOf(proto()) === null && proto().a === 1);
function quoted() { return { "__proto__": 1, ["__proto__"]: 2 } as any; }
report(Object.keys(quoted()).join() + String(Object.getPrototypeOf(quoted()) === Object.prototype));
function repeated() { return { a: 1, b: 2, a: 3 } as any; }
report(show(repeated()));
function many() { return { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18 }; }
const manyOnce = many();
manyOnce.r = 0;
report(show(manyOnce) + show(many()));
function frozen() { return Object.freeze({ on: 1, off: 0 }); }
report(Object.isFrozen(frozen()) && frozen() !== frozen());
function kinds() { return new Set(["p", "q", "p"]); }
const someKinds = kinds();
report(someKinds === kinds());
someKinds.add("r");
someKinds.delete("p");
report(show(someKinds) + show(kinds()) + kinds().size + kinds().has("q") + kinds().has("r"));
function codes() { return new Map<any, any>([["p", 1], ["q", 2], ["p", 3]]); }
const someCodes = codes();
someCodes.set("r", 4);
someCodes.delete("q");
report(show(someCodes) + show(codes()) + codes().size + codes().get("p") + codes().get("r"));
function numbers() { return new Set([1, 2, 3.5, -0, 0, NaN, NaN, 1e21, -1]); }
report(show(numbers()) + numbers().has(0) + numbers().has(-0) + numbers().has(NaN) + Object.is([...numbers()][3], 0));
function mixed() { return new Set<any>([1, "1", true, null, undefined, 10n, 10n, "", 1.0]); }
report(show(mixed()) + mixed().size);
function mapOfMixed() { return new Map<any, any>([[1, "n"], ["1", "s"], [null, undefined], [undefined, null], [-0, "zero"], [NaN, "nan"], [10n, 1n]]); }
report(show(mapOfMixed()) + mapOfMixed().get(0) + mapOfMixed().get(NaN) + mapOfMixed().get(10n) + Object.is([...mapOfMixed().keys()][4], 0));
function setOfLists() { return new Set([[1], [1]]); }
const listsInSet = [...setOfLists()];
report(listsInSet.length + "," + (listsInSet[0] === listsInSet[1]) + "," + ([...setOfLists()][0] === listsInSet[0]));
function mapOfObjects() { return new Map([["a", { n: 1 }], ["b", { n: 2 }]]); }
const objectsInMap = mapOfObjects();
objectsInMap.get("a")!.n = 9;
report(show(objectsInMap) + show(mapOfObjects()));
function setWithHole() { return new Set([1, , 3]); }
report(show(setWithHole()) + setWithHole().has(undefined));
function emptySet() { return new Set([]); }
function emptyMap() { return new Map([]); }
report(emptySet().size + emptyMap().size);
function shortPair() { return new Map<any, any>([["a"] as any, ["b", 1, 2] as any]); }
report(show(shortPair()));
try { report(show(new Map<any, any>([1 as any]))); } catch (error) { report(error instanceof TypeError); }
const SHARED = ["x", "y"];
function setOfShared() { return new Set(SHARED); }
report(show(setOfShared()));
SHARED.push("z");
report(show(setOfShared()));
function listSeenTwice() { const source = ["m", "n"]; const made = new Set(source); source.push("o"); return show(made) + show(source); }
report(listSeenTwice());
function listChangedFirst() { const source = ["m", "n"]; source.push("o"); source[0] = "M"; return show(new Set(source)); }
report(listChangedFirst());
function pairsChangedFirst() { const source: any[] = [["m", 1], ["n", 2]]; source[0][1] = 9; return show(new Map(source)); }
report(pairsChangedFirst());
function listKept() { const source = [[1], [2]]; const made = new Set(source); return made.has(source[0]) && [...made][1] === source[1]; }
report(listKept());
function inLoop(n: number) { const made: Set<string>[] = []; for (let i = 0; i < n; i++) made.push(new Set(["l"])); made[0].add("x"); return show(made) + (made[0] === made[1]); }
report(inLoop(2));
function objectsInLoop(n: number) { const made: any[] = []; for (let i = 0; i < n; i++) made.push({ i: 0, list: [0] }); made[0].i = 1; made[0].list.push(1); return show(made); }
report(objectsInLoop(2));
class Counting extends Set<string> { static adds = 0; add(value: string) { Counting.adds++; return super.add(value); } }
report(new Counting(["a", "b"]).size + "," + Counting.adds);
class Doubling extends Map<string, number> { set(key: string, value: number) { return super.set(key, value * 2); } }
report(show(new Doubling([["a", 1]])));
report(show(Reflect.construct(Set, [["a", "b"]], Counting)) + Counting.adds);
report(Object.getPrototypeOf(kinds()) === Set.prototype && Object.getPrototypeOf(codes()) === Map.prototype);
report(Object.keys(kinds()).length + Object.getOwnPropertySymbols(codes()).length);
function iterated() { let s = ""; for (const kind of new Set(["i", "j"])) s += kind; for (const [key, value] of new Map([["k", 1]])) s += key + value; return s; }
report(iterated());
function grown() { const set = new Set(["a"]); for (let i = 0; i < 100; i++) set.add("k" + i); return set.size + [...set][100]; }
report(grown());
function cleared() { const map = new Map([["a", 1], ["b", 2]]); map.clear(); map.set("c", 3); return show(map); }
report(cleared());
function walkedAndChanged() { const set = new Set(["a", "b", "c"]); let s = ""; for (const member of set) { s += member; if (member === "a") { set.delete("b"); set.add("d"); } } return s; }
report(walkedAndChanged());
function largeSet() { return new Set(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "d0", "d1", "d2", "d3"]); }
const oneLarge = largeSet();
oneLarge.delete("a0");
oneLarge.add("z");
report(oneLarge.size + "," + largeSet().size + "," + largeSet().has("a0") + oneLarge.has("a0") + largeSet().has("z") + [...oneLarge][33] + [...largeSet()][0]);
function tag(strings: TemplateStringsArray, ...values: any[]) { return strings; }
function template() { return tag`a${1}b`; }
report(template() === template());
report(Object.isFrozen(template()) + template().raw.join("|"));
report(tag`a${1}b` === tag`a${1}b`);
const TABLE = { alpha: 1, beta: "two", gamma: [1, 2, 3], delta: { deep: true } };
const ALIAS = TABLE;
TABLE.gamma.push(4);
(TABLE as any).more = 1;
report(show(ALIAS));
report("end");

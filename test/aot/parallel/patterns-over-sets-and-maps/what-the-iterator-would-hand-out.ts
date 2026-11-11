// A pattern over what the compiler knows nothing about meets sets and maps at run time. It takes what their iterators would hand
// out: in the order of insertion, past what was deleted, nothing of what was cleared, `undefined` behind the end; a map hands out
// a new pair at every take. What is no set or map as made (a method of its own, a class below, another prototype) goes by its method.
const lines: string[] = [];
function show(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join(",") + "}";
    return Object.is(value, -0) ? "-0" : String(value);
}
function takeNone(values: any) { const [] = values; return "none"; }
function takeOne(values: any) { const [first] = values; return show(first); }
function takeFour(values: any) { const [first, second, third, fourth] = values; return [first, second, third, fourth].map(show).join(" "); }
function takeWithHoles(values: any) { const [, second, , fourth] = values; return show(second) + " " + show(fourth); }
function takeWithDefaults(values: any) { const [first = "d1", second = "d2", third = "d3"] = values; return [first, second, third].map(show).join(" "); }
function takeWithRest(values: any) { const [first, ...others] = values; return show(first) + " + " + show(others); }
function takeNested(values: any) { const [[key, value] = ["no", "pair"], [key2] = ["none"]] = values; return [key, value, key2].map(show).join(" "); }
function takeInLoop(values: any) { let all = ""; for (let turn = 0; turn < 4; turn++) { const [first, second] = values; all += show(first) + show(second) + ";"; } return all; }
const takers: [string, (values: any) => string][] = [["none", takeNone], ["one", takeOne], ["four", takeFour], ["holes", takeWithHoles], ["defaults", takeWithDefaults], ["rest", takeWithRest], ["loop", takeInLoop]];
function all(name: string, values: any) { lines.push(name + ": " + takers.map(([taker, take]) => taker + "=" + take(values)).join(" | ")); }

const shared = { tag: 1 };
all("empty set", new Set());
all("empty map", new Map());
all("set of one", new Set(["only"]));
all("set of four", new Set([1, 2, 3, 4]));
all("set of six", new Set([1, 2, 3, 4, 5, 6]));
all("set of kinds", new Set([undefined, null, NaN, -0, "text", shared, 1.5, true, 2 ** 40]));
all("map of one", new Map([["k", "v"]]));
all("map of five", new Map<unknown, unknown>([[1, "a"], ["two", 2], [shared, shared], [undefined, undefined], [NaN, -0]]));
lines.push("nested: " + takeNested(new Map([["k", "v"], ["l", "w"]])) + " | " + takeNested(new Map()) + " | " + takeNested(new Set([[1, 2], [3]])));

const thinned = new Set<number>(); for (let n = 0; n < 12; n++) thinned.add(n);
for (const gone of [0, 1, 2, 5, 11]) { thinned.delete(gone); lines.push("without " + gone + ": " + takeFour(thinned) + " | " + takeInLoop(thinned)); }
thinned.add(0); lines.push("0 again, now last: " + takeWithRest(thinned));
thinned.clear(); all("cleared set", thinned);
thinned.add(7); thinned.add(8); all("filled again", thinned);

const eaten = new Map<string, number>(); for (let n = 0; n < 40; n++) eaten.set("k" + n, n);
let meal = "";
while (eaten.size) { const [[key, value], next] = eaten as any; meal += key + "=" + value + (next ? "<" + next[0] : "!") + " "; eaten.delete(key); if (value % 7 === 0) eaten.set("again" + value, -value); if (meal.length > 900) break; }
lines.push("eaten from the front: " + meal);

const grown = new Set<unknown>(); let seen = "";
for (let n = 0; n < 300; n++) { grown.add(n % 3 ? n : "s" + n); if ((n & (n + 1)) === 0) { const [first, second, third] = grown as any; seen += show(first) + show(second) + show(third) + ";"; } }
lines.push("while it grows: " + seen);

const pairs = new Map([["k", 1]]);
const [one] = pairs as any, [other] = pairs as any;
one[1] = "written"; one.push("more");
lines.push("pairs are new: " + (one !== other) + " " + show(other) + " " + show([...pairs]));

class Below extends Set<unknown> {}
class BelowWithMethod extends Set<unknown> { *[Symbol.iterator](): any { yield "of the class below"; } }
class MapBelowWithMethod extends Map<unknown, unknown> { *[Symbol.iterator](): any { yield ["of", "the class below"]; } }
const withOwn = new Set<unknown>([1, 2]); (withOwn as any)[Symbol.iterator] = function* () { yield "its own"; };
const mapWithOwn = new Map<unknown, unknown>([[1, 2]]); (mapWithOwn as any)[Symbol.iterator] = function () { return [["its", "own"]][Symbol.iterator](); };
const underAnother = new Set<unknown>([1, 2]); Object.setPrototypeOf(underAnother, { [Symbol.iterator]: function* () { yield "of another prototype"; } });
const underNone = new Map<unknown, unknown>([[1, 2]]); Object.setPrototypeOf(underNone, null);
all("a class below", new Below([1, 2, 3]));
all("a class below with a method", new BelowWithMethod([1, 2, 3]));
all("a map's class below with a method", new MapBelowWithMethod([[1, 2]]));
all("a method of its own", withOwn);
all("a map's method of its own", mapWithOwn);
all("another prototype", underAnother);
try { takeOne(underNone); lines.push("no prototype: taken"); } catch (error) { lines.push("no prototype: " + (error as Error).constructor.name); }

let closed = 0;
const byHand = { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: false, value: n++ }), return: () => { closed++; return {}; } }; } };
lines.push("an iterator of the program is closed: " + takeOne(byHand) + " " + takeFour(byHand) + " " + takeInLoop(byHand) + " closes " + closed);
const handed = new Set([1, 2, 3]).values(); (handed as any).return = () => { closed += 100; return {}; };
lines.push("an iterator of the engine with a return of its own: " + takeOne(handed) + " " + takeOne(handed) + " closes " + closed);
const handedPairs: any = new Map([[1, 2], [3, 4]]).entries(); let closedPairs = 0; handedPairs.return = () => { closedPairs++; return {}; };
const [firstPair] = handedPairs as any;
lines.push("the entries of a map with a return of their own: " + String(firstPair) + " " + closedPairs);
for (const line of lines) console.log(line);

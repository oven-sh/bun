// `const item: Item = pick(n)`: what comes back from a function held in a variable, a parameter or a field is used at once as what its type says: fields are read, methods called, strings measured.
interface Item { id: number; label: string; next: Item | undefined }
interface Named { label: string }
class Box { constructor(public item: Item, public size: number) { } grow(): Box { return new Box(this.item, this.size + 1); } }
class Crate extends Box { lid = "shut"; }
type Pick = (n: number) => Item;
type MaybePick = (n: number) => Item | undefined;
type Name = (item: Item) => string;
type Wrap = (item: Item) => Box;
type Test = (item: Item) => boolean;
type List = (item: Item) => Item[];
type Make = () => Named;
type Again = (item: Item) => Name;
interface Tools { pick: Pick; name: Name; wrap: Wrap; test: Test; maybe?: MaybePick }

const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" ")); }
const items: Item[] = [];
for (let i = 0; i < 8; i++) items.push({ id: i, label: "item" + i, next: undefined });
for (let i = 0; i + 1 < items.length; i++) items[i].next = items[i + 1];

function usePick(pick: Pick, n: number): string { const item: Item = pick(n); return item.label + "/" + (item.next ? item.next.id : "end"); }
function useMaybe(pick: MaybePick, n: number): string { const item = pick(n); return item ? item.label : "none"; }
function useName(name: Name, item: Item): number { return name(item).length; }
function useWrap(wrap: Wrap, item: Item): string { const box = wrap(item); return box.item.label + "#" + box.grow().size; }
function useTest(test: Test, item: Item): string { return test(item) ? "yes" : "no"; }
function useList(list: List, item: Item): string { const all = list(item); return all.length + ":" + all.map(each => each.id).join(); }
function useMake(make: Make): string { return make().label; }
function useAgain(again: Again, item: Item): string { return again(item)(item); }
function useTools(tools: Tools, n: number): string { const item = tools.pick(n); return tools.name(item) + tools.wrap(item).size + tools.test(item) + (tools.maybe ? tools.maybe(n)?.id : "-"); }
function inLoop(pick: Pick, times: number): number { let total = 0; for (let i = 0; i < times; i++) total += pick(i & 7).id; return total; }

function at(shift: number): Pick { return n => items[(n + shift) & 7]; }
function below(limit: number): MaybePick { return n => (n < limit ? items[n & 7] : undefined); }
function labelWith(mark: string): Name { return item => mark + item.label; }
function boxOf(size: number): Wrap { return item => new Box(item, size); }
function crateOf(size: number): Wrap { return item => new Crate(item, size); }
function after(id: number): Test { return item => item.id > id; }
function chain(most: number): List { return item => { const all: Item[] = []; for (let each: Item | undefined = item; each && all.length < most; each = each.next) all.push(each); return all; }; }
function first(n: number): Item { return items[n & 7]; }
function upper(item: Item): string { return item.label.toUpperCase(); }
function withDefault(n: number, shift = 2): Item { return items[(n + shift) & 7]; }
function withRest(n: number, ...more: number[]): Item { return items[(n + more.length) & 7]; }
function withArguments(): Item { return items[arguments.length & 7]; }
function withThis(this: unknown, n: number): Item { return items[(this === undefined ? n : n + 1) & 7]; }

let held: Pick = at(1);
const table: Pick[] = [at(0), first, withDefault, at(5)];
for (let round = 0; round < 3; round++) {
    say("closures", usePick(at(round), 1), usePick(held, round), usePick(table[round], 2), usePick(first, round), useMaybe(below(round), 1), useMaybe(at(round), 1));
    say("strings", useName(labelWith("<" + round), items[round]), useName(upper, items[round]), useName(item => item.label, items[round]), useName(() => "", items[round]));
    say("objects of classes", useWrap(boxOf(round), items[round]), useWrap(crateOf(round), items[round]), useWrap(item => new Box(item, 7).grow(), items[1]));
    say("booleans", useTest(after(round), items[2]), useTest(() => true, items[0]), useTest(item => item.next === undefined, items[7]));
    say("arrays", useList(chain(round + 1), items[4]), useList(() => [], items[0]), useList(item => [item, item], items[round]));
    say("a narrower object for a wider type", useMake(() => items[round]), useMake(() => ({ label: "plain" + round })), useMake(() => new Crate(items[0], 1).item));
    say("functions that yield functions", useAgain(() => upper, items[round]), useAgain(item => labelWith(item.label), items[round]));
    say("other numbers of parameters", usePick(withDefault, round), usePick(withRest, round), usePick(withArguments as Pick, round), usePick(withThis, round), usePick(() => items[round], 5));
    say("members", useTools({ pick: at(round), name: upper, wrap: boxOf(round), test: after(1) }, round), useTools({ pick: first, name: labelWith("-"), wrap: crateOf(2), test: after(9), maybe: below(2) }, round));
    say("in a loop", inLoop(at(round), 1000), inLoop(first, 1000), inLoop(held, 1000));
    const tagged = Object.assign(at(round), { tag: "t" + round });
    say("functions that were given properties", usePick(tagged, 1), tagged.tag, usePick(Object.freeze(at(round)), 1));
    say("bound functions and proxies", usePick(first.bind(null), round), usePick(withDefault.bind(null, 1), round), usePick(new Proxy(first, {}), round), usePick(new Proxy(first, { apply: (target, self, list) => target(list[0] + 1) }), round));
    say("functions of the engine", useName(String as unknown as Name, items[round]), useName(JSON.stringify as unknown as Name, items[7]), useTest(Boolean as unknown as Test, items[round]), useList(Array.of as unknown as List, items[round]));
    say("untyped functions", usePick(((n: any) => items[n & 7]) as Pick, round), useName(((item: any) => item.label + "!") as Name, items[round]));
    held = round & 1 ? first : at(round + 3);
}

const hop: Pick = n => (n > 0 ? skip(n - 1) : items[3]);
const skip: Pick = n => hop(n);
function viaCall(pick: Pick, n: number): Item { return pick(n); }
say("what comes back out of calls in tail position", usePick(hop, 5), usePick(skip, 4), usePick(n => viaCall(hop, n), 3), usePick(n => viaCall(first, n), 6), inLoop(hop, 100));
let depth = 0;
const forever: Pick = n => { depth++; const item = forever(n + 1); return item.next ?? item; };
try { say("never", usePick(forever, 0)); } catch (error) { say("endless recursion", error instanceof RangeError, depth > 1000); }
try { say("never", usePick(() => { throw new RangeError("inside"); }, 0)); } catch (error) { say("it throws", (error as Error).message); }
for (const what of [undefined, null, 5, "text", {}, class { }] as unknown[]) {
    try { say("never", usePick(what as Pick, 0)); } catch (error) { say("what is no function", error instanceof TypeError); }
}

// Many calls ask for each type, from many places.
function pickId(f: Pick, n: number): number { return f(n).id; }
function pickLabel(f: Pick, n: number): string { return f(n).label; }
function pickRest(f: Pick, n: number): string { const item: Item = f(n); return item.next ? "more" : "last"; }
function pickTwice(f: Pick, n: number): number { return f(n).id * 10 + f(n + 1).id; }
function pickInto(f: Pick, n: number): string { return upper(f(n)); }
function maybeId(f: MaybePick, n: number): number { const item = f(n); return item === undefined ? -1 : item.id; }
function maybeLabel(f: MaybePick, n: number): string { return f(n)?.label ?? "nothing"; }
function maybeTwice(f: MaybePick, n: number): string { const one = f(n), two = f(n + 4); return (one ? one.id : "-") + "" + (two ? two.id : "-"); }
function maybeRest(f: MaybePick, n: number): boolean { const item: Item | undefined = f(n); return !!item && !!item.next; }
function nameFirst(f: Name, item: Item): string { return f(item).charAt(0); }
function nameUpper(f: Name, item: Item): string { return f(item).toUpperCase(); }
function nameTwice(f: Name, item: Item): string { return f(item) + "+" + f(item.next ?? item); }
function nameKept(f: Name, item: Item): number { const text: string = f(item); return text.length * 2; }
function wrapSize(f: Wrap, item: Item): number { return f(item).size; }
function wrapItem(f: Wrap, item: Item): string { return f(item).item.label; }
function wrapGrown(f: Wrap, item: Item): number { const box: Box = f(item); return box.grow().grow().size; }
function wrapTwice(f: Wrap, item: Item): boolean { return f(item) === f(item); }
function listLength(f: List, item: Item): number { return f(item).length; }
function listFirst(f: List, item: Item): string { const all: Item[] = f(item); return all.length ? all[0].label : "empty"; }
function listSum(f: List, item: Item): number { let sum = 0; for (const each of f(item)) sum += each.id; return sum; }
function listTwice(f: List, item: Item): number { return f(item).length + f(item.next ?? item).length; }
const picks: Pick[] = [at(0), at(3), first, withDefault, withRest, withThis, () => items[6], first.bind(null), new Proxy(first, {}), ((n: any) => items[n & 7]) as Pick, Object.assign(at(2), { tag: 1 }), hop, skip];
const maybes: MaybePick[] = [below(2), below(9), at(1), first, () => undefined, n => (n & 1 ? items[n & 7] : undefined), below(3).bind(null), ((n: any) => (n ? items[1] : undefined)) as MaybePick];
const namers: Name[] = [upper, labelWith("~"), item => item.label, () => "fixed", upper.bind(null), String as unknown as Name, ((item: any) => item.label + "?") as Name];
const wrappers: Wrap[] = [boxOf(1), crateOf(2), item => new Box(item, 3).grow(), boxOf(4).bind(null), ((item: any) => new Crate(item, 5)) as Wrap];
const listers: List[] = [chain(1), chain(3), () => [], item => [item, item], Array.of as unknown as List, chain(2).bind(null), ((item: any) => [item]) as List];
for (let round = 0; round < 2; round++) {
    say("every function that picks", picks.map(f => [pickId(f, round), pickLabel(f, round), pickRest(f, round + 6), pickTwice(f, round), pickInto(f, round)].join("/")).join(" "));
    say("every function that may pick", maybes.map(f => [maybeId(f, round), maybeLabel(f, round + 1), maybeTwice(f, round), maybeRest(f, round)].join("/")).join(" "));
    say("every function that names", namers.map(f => [nameFirst(f, items[round]), nameUpper(f, items[round]), nameTwice(f, items[round + 6]), nameKept(f, items[round])].join("/")).join(" "));
    say("every function that wraps", wrappers.map(f => [wrapSize(f, items[round]), wrapItem(f, items[round]), wrapGrown(f, items[round]), wrapTwice(f, items[round])].join("/")).join(" "));
    say("every function that lists", listers.map(f => [listLength(f, items[round]), listFirst(f, items[round]), listSum(f, items[round + 4]), listTwice(f, items[round + 6])].join("/")).join(" "));
}
console.log(lines.join("\n"));

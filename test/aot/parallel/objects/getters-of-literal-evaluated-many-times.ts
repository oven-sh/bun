// One literal with getters makes many objects. Each object has getters of its own, in the order of the literal, and what is done to one object says nothing about the next.
const out: string[] = [];
const log = (...parts: unknown[]) => { out.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")); };
const describe = (object: object) => Object.entries(Object.getOwnPropertyDescriptors(object)).map(([key, d]) => key + ":" + ("get" in d ? (d.get ? "g" : "-") + (d.set ? "s" : "-") : "v") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-")).join(" ");

interface Source { id: number; name: string; list: number[] }
function viewOf(source: Source) {
  return {
    get id() { return source.id; },
    get name() { return source.name; },
    get size() { return source.list.length; },
    get first() { return source.list[0]; },
    get never() { return source.name + source.id; },
    plain: source.id * 2,
    get last() { return source.list[source.list.length - 1]; },
  };
}
const views = [1, 2, 3, 4, 5, 6].map(id => viewOf({ id, name: "n" + id, list: [id, id + 1, id + 2].slice(0, (id % 3) + 1) }));
for (const view of views) log(view.id, view.name, view.size, view.first, view.last, view.plain);
log(describe(views[0]!)); log(describe(views[5]!));
log(Object.keys(views[3]!).join(), JSON.stringify(views[4]));
log("own getters", Object.getOwnPropertyDescriptor(views[0]!, "id")!.get === Object.getOwnPropertyDescriptor(views[1]!, "id")!.get, Object.getOwnPropertyDescriptor(views[0]!, "id")!.get === Object.getOwnPropertyDescriptor(views[0]!, "id")!.get);
log("called on another object", Object.getOwnPropertyDescriptor(views[2]!, "never")!.get!.call(views[0]));

// What happens to one object stays with it.
delete (views[0] as any).name;
Object.defineProperty(views[1]!, "id", { value: "data now", enumerable: false });
Object.defineProperty(views[2]!, "size", { get() { return "other getter"; }, configurable: true, enumerable: true });
Object.freeze(views[3]);
(views[4] as any).added = 1;
Object.setPrototypeOf(views[5]!, { inherited: "yes" });
for (const view of views) log(describe(view), (view as any).inherited);
const later = viewOf({ id: 9, name: "later", list: [] });
log(describe(later), JSON.stringify(later), later.first, later.last);
try { "use strict"; (later as any).id = 3; log("stored"); } catch (error) { log((error as Error).constructor.name); }

// Getters and setters of one name, names that are no identifiers, symbols, computed keys that name a member again.
const tag = Symbol("tag");
let written: unknown[] = [];
function mixed(n: number, key: string) {
  return {
    get both() { return n; }, set both(value: number) { written.push(value + n); },
    get twice() { return "once " + n; },
    set only(value: number) { written.push(-value); },
    get 0() { return "zero " + n; }, get "a b"() { return "spaced " + n; }, get [tag]() { return "symbol " + n; }, get [key]() { return "computed " + n; },
    data: n, get data2() { return n + 1; },
  };
}
for (const [n, key] of [[1, "x"], [2, "y"], [3, "data"], [4, "both"]] as [number, string][]) {
  const object: any = mixed(n, key);
  object.both = 10; object.only = n;
  log(describe(object), object.both, object.twice, object[0], object["a b"], object[tag], object[key], object.data, object.data2, object.only);
}
log(written);

// More getters than one operation takes, and objects that grow old between the allocation and the getters.
function wide(n: number) {
  const pause = () => { if (n % 7 === 0) Bun.gc(true); return n; };
  return {
    get g0() { return n; }, get g1() { return n + 1; }, get g2() { return n + 2; }, get g3() { return n + 3; }, get g4() { return n + 4; }, get g5() { return n + 5; }, get g6() { return n + 6; }, get g7() { return n + 7; },
    get g8() { return n + 8; }, get g9() { return n + 9; }, get g10() { return n + 10; }, get g11() { return n + 11; }, get g12() { return n + 12; }, get g13() { return n + 13; }, get g14() { return n + 14; }, get g15() { return n + 15; },
    middle: pause(),
    get g16() { return n + 16; }, get g17() { return n + 17; }, get g18() { return n + 18; }, get g19() { return n + 19; }, get g20() { return n + 20; }, get g21() { return n + 21; }, get g22() { return n + 22; }, get g23() { return n + 23; },
    get g24() { return n + 24; }, get g25() { return n + 25; }, get g26() { return n + 26; }, get g27() { return n + 27; }, get g28() { return n + 28; }, get g29() { return n + 29; }, get g30() { return n + 30; }, get g31() { return n + 31; },
    get g32() { return n + 32; }, get g33() { return n + 33; }, get g34() { return n + 34; }, get g35() { return n + 35; }, get g36() { return n + 36; }, get g37() { return n + 37; }, get g38() { return n + 38; }, get g39() { return n + 39; },
  };
}
let sum = 0; const keptWide: ReturnType<typeof wide>[] = [];
for (let n = 0; n < 60; n++) { const object = wide(n); keptWide.push(object); if (n % 11 === 0) Bun.gc(true); for (const value of Object.values(object)) sum += value; }
Bun.gc(true);
log(sum, keptWide.reduce((total, object) => total + object.g0 + object.g15 + object.g16 + object.g39 + object.middle, 0), Object.keys(keptWide[59]!).length, Object.keys(keptWide[7]!).slice(14, 20).join());

// Two literals of one type, with getters of their own.
interface Pair { readonly left: number; readonly right: number }
const plus = (n: number): Pair => ({ get left() { return n + 1; }, get right() { return n + 2; } });
const minus = (n: number): Pair => ({ get left() { return n - 1; }, get right() { return n - 2; } });
const swapped = (n: number): Pair => ({ get right() { return n * 2; }, get left() { return n * 3; } });
const pairs: Pair[] = [];
for (let n = 0; n < 12; n++) pairs.push([plus, minus, swapped][n % 3]!(n));
log(pairs.map(pair => pair.left + ":" + pair.right + ":" + Object.keys(pair).join("")).join(" "));

// A literal that is a prototype, a literal with another prototype, a literal behind a spread.
const base = (n: number) => ({ get inherited() { return "from base " + n; }, get shadowed() { return "base"; } });
for (let n = 0; n < 4; n++) {
  const child: any = Object.create(base(n)); Object.defineProperty(child, "shadowed", { get() { return "child " + n; } });
  const below = { __proto__: base(n + 10), get own() { return "own " + n; } } as any;
  const copy = { ...base(n + 20), get extra() { return n; } };
  log(child.inherited, child.shadowed, below.inherited, below.own, describe(below), describe(copy), copy.inherited);
}
console.log(out.join("\n"));

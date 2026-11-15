const call = new Function("f", "a", "b", "return f(a, b)") as (f: Function, a?: unknown, b?: unknown) => any;
class Inner { size = 2; }
class Crate {
    isOpen = false;
    count = 0;
    ratio = 0.5;
    label = "";
    inner = new Inner();
    items = [1, 2];
    nothing = null;
    missing = undefined;
    big = 1n;
    make = () => 7;
    record = { depth: 1 };
}
function truthOfFlag(c: Crate) { if (c.isOpen) return 1; return 2; }
function notFlag(c: Crate) { return !c.isOpen; }
function flagIsTrue(c: Crate) { return c.isOpen === true; }
function countPlusOne(c: Crate) { return c.count + 1; }
function countBits(c: Crate) { return c.count & 6; }
function truthOfCount(c: Crate) { return c.count ? "some" : "none"; }
function countIsThree(c: Crate) { return c.count === 3; }
function countBelow(c: Crate) { return c.count < 10; }
function halfOfRatio(c: Crate) { return c.ratio / 2; }
function lengthOfLabel(c: Crate) { return c.label.length; }
function truthOfLabel(c: Crate) { return c.label ? 1 : 0; }
function labelIsX(c: Crate) { return c.label === "x"; }
function labelAndMore(c: Crate) { return c.label + "!"; }
function sizeOfInner(c: Crate) { return c.inner.size; }
function firstItem(c: Crate) { return c.items[0]; }
function numberOfItems(c: Crate) { return c.items.length; }
function isNothing(c: Crate) { return c.nothing === null; }
function isMissing(c: Crate) { return c.missing === undefined; }
function bigPlusOne(c: Crate) { return c.big + 1n; }
function made(c: Crate) { return c.make(); }
function depth(c: Crate) { return c.record.depth; }
function inLoop(c: Crate) { let sum = 0; for (let i = 0; i < 3; i++) { if (c.isOpen) sum += c.count; sum += c.label.length; } return sum; }
function setFlag(c: Crate, v: boolean) { c.isOpen = v; return c.isOpen; }
function setCount(c: Crate, v: number) { c.count = v; return c.count; }
function setLabel(c: Crate, v: string) { c.label = v; return c.label; }
const readers = [truthOfFlag, notFlag, flagIsTrue, countPlusOne, countBits, truthOfCount, countIsThree, countBelow, halfOfRatio, lengthOfLabel, truthOfLabel, labelIsX, labelAndMore, sizeOfInner, firstItem, numberOfItems, isNothing, isMissing, bigPlusOne, made, depth, inLoop];
function show(value: unknown) { return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? JSON.stringify(value) : String(value); }
function readAll(title: string, c: unknown) {
    let line = title + ":";
    for (const f of readers) { let answer: string; try { answer = show(call(f, c)); } catch (e) { answer = "throws " + (e as Error).constructor.name; } line += " " + answer; }
    console.log(line);
}
const plain = new Crate();
for (let i = 0; i < 3; i++) readAll("as made", plain);
for (const other of [{ isOpen: "o", count: "c", ratio: "r", label: 1, inner: { size: 0 }, items: "xy", nothing: 0, missing: 0, big: 0n, make() { return 1; }, record: { depth: null } }, {}, Object.create(plain), Object.create(null), new Proxy(plain, { get(t, k) { return k === "isOpen" ? "proxied" : (t as any)[k]; } }), [], "text", 5, null, undefined, Object.freeze(new Crate())])
    readAll(Object.prototype.toString.call(other), other);

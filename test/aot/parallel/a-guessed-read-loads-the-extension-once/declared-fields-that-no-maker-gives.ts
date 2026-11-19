class Crate {
    tag: number; label: string;
    constructor(tag: number, label: string) { this.tag = tag; this.label = label; }
    whole?: number; half?: number; text?: string; flag?: boolean; inner?: Crate; list?: number[]; any?: unknown; big?: bigint; maker?: () => number; nothing?: undefined; none?: null;
}
function fill(crate: Crate, step: number) {
    if (step & 1) crate.whole = step;
    if (step & 2) crate.half = step + 0.5;
    if (step & 4) crate.text = "t" + step;
    if (step & 8) crate.flag = (step & 16) !== 0;
    if (step & 16) crate.inner = new Crate(-step, "inner");
    if (step & 32) crate.list = [step, step + 1];
    if (step & 64) crate.any = step % 3 ? "any" : { step };
    if (step & 128) crate.big = BigInt(step);
    if (step & 256) crate.maker = () => step;
    if (step & 512) crate.nothing = undefined;
    if (step & 1024) crate.none = null;
}
function wholeOf(crate: Crate) { return crate.whole; }
function halfOf(crate: Crate) { return crate.half; }
function textOf(crate: Crate) { return crate.text; }
function flagOf(crate: Crate) { return crate.flag; }
function innerTagOf(crate: Crate) { return crate.inner ? crate.inner.tag : "no inner"; }
function lengthOf(crate: Crate) { return crate.list ? crate.list.length : -1; }
function anyOf(crate: Crate) { return crate.any; }
function bigOf(crate: Crate) { return crate.big; }
function madeBy(crate: Crate) { return crate.maker ? crate.maker() : "no maker"; }
function has(crate: Crate) { return ("whole" in crate ? 1 : 0) + ("nothing" in crate ? 2 : 0) + ("none" in crate ? 4 : 0) + (crate.nothing === undefined ? 8 : 0) + (crate.none === null ? 16 : 0); }
function sumOf(crate: Crate) { return (crate.whole ?? 0) + (crate.half ?? 0) + (crate.text ? crate.text.length : 0) + (crate.flag ? 1 : 0); }
function twice(crate: Crate) { const first = crate.whole; fill(crate, 1 | 4); return [first, crate.whole, crate.text]; }
function caught(crate: Crate) { try { if (crate.flag) throw new Error("flag " + crate.text); return crate.half; } catch (error) { return (error as Error).message + crate.whole; } }
const readers = [wholeOf, halfOf, textOf, flagOf, innerTagOf, lengthOf, anyOf, bigOf, madeBy, has, sumOf, caught];
(globalThis as any).shown = [...readers, twice, fill];
const said: string[] = [];
const show = (value: unknown) => typeof value === "object" && value ? JSON.stringify(value) : String(value);
for (let step = 0; step < 2048; step += 37) {
    const crate = new Crate(step, "c" + step); fill(crate, step);
    said.push(show(wholeOf(crate)), show(halfOf(crate)), show(textOf(crate)), show(flagOf(crate)), show(innerTagOf(crate)), show(lengthOf(crate)), show(anyOf(crate)), show(bigOf(crate)), show(madeBy(crate)), show(has(crate)), show(sumOf(crate)), show(caught(crate)));
    for (const reader of (globalThis as any).shown.slice(0, 12)) said.push(show(reader(crate)));
    said.push(show(twice(new Crate(step, "again"))));
}
console.log(said.length, said.join("|"));

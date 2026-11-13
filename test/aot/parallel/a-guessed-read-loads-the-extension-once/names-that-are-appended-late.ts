class Crate {
    tag: number; label: string;
    constructor(tag: number, label: string) { this.tag = tag; this.label = label; }
}
function fill(crate: Crate, step: number) {
    if (step & 1) (crate as any).whole = step;
    if (step & 2) (crate as any).half = step + 0.5;
    if (step & 4) (crate as any).text = "t" + step;
    if (step & 8) (crate as any).flag = (step & 16) !== 0;
    if (step & 16) (crate as any).inner = new Crate(-step, "inner");
    if (step & 32) (crate as any).list = [step, step + 1];
    if (step & 64) (crate as any).any = step % 3 ? "any" : { step };
    if (step & 128) (crate as any).big = BigInt(step);
    if (step & 256) (crate as any).maker = () => step;
    if (step & 512) (crate as any).nothing = undefined;
    if (step & 1024) (crate as any).none = null;
}
function wholeOf(crate: Crate) { return (crate as any).whole; }
function halfOf(crate: Crate) { return (crate as any).half; }
function textOf(crate: Crate) { return (crate as any).text; }
function flagOf(crate: Crate) { return (crate as any).flag; }
function innerTagOf(crate: Crate) { return (crate as any).inner ? (crate as any).inner.tag : "no inner"; }
function lengthOf(crate: Crate) { return (crate as any).list ? (crate as any).list.length : -1; }
function anyOf(crate: Crate) { return (crate as any).any; }
function bigOf(crate: Crate) { return (crate as any).big; }
function madeBy(crate: Crate) { return (crate as any).maker ? (crate as any).maker() : "no maker"; }
function has(crate: Crate) { return ("whole" in crate ? 1 : 0) + ("nothing" in crate ? 2 : 0) + ("none" in crate ? 4 : 0) + ((crate as any).nothing === undefined ? 8 : 0) + ((crate as any).none === null ? 16 : 0); }
function sumOf(crate: Crate) { return ((crate as any).whole ?? 0) + ((crate as any).half ?? 0) + ((crate as any).text ? (crate as any).text.length : 0) + ((crate as any).flag ? 1 : 0); }
function twice(crate: Crate) { const first = (crate as any).whole; fill(crate, 1 | 4); return [first, (crate as any).whole, (crate as any).text]; }
function caught(crate: Crate) { try { if ((crate as any).flag) throw new Error("flag " + (crate as any).text); return (crate as any).half; } catch (error) { return (error as Error).message + (crate as any).whole; } }
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

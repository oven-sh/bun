class Crate { tag = 1; whole?: number; text?: string; inner?: Crate; more?: number; }
function late(crate: Crate, step: number) { crate.whole = step; crate.text = "t" + step; crate.more = step * 2; }
function read(crate: Crate) { return String(crate.whole) + "," + String(crate.text) + "," + String(crate.more) + "," + String(crate.inner ? crate.inner.whole : "none"); }
function readAround(crate: Crate, deed: (crate: any) => void) { const before = crate.whole; const text = crate.text; deed(crate); return [before, text, crate.whole, crate.text, crate.more, "whole" in crate, Object.keys(crate).join("+")].map(String).join(","); }
(globalThis as any).shown = [late, read, readAround];
const deeds: ((crate: any) => void)[] = [
    () => {}, crate => { delete crate.whole; }, crate => { delete crate.text; crate.text = "again"; }, crate => { crate.whole = "a text"; }, crate => { crate.whole = 1.5; }, crate => { crate.whole = undefined; },
    crate => { Object.defineProperty(crate, "whole", { get() { return "got"; }, configurable: true }); }, crate => { Object.defineProperty(crate, "text", { value: "fixed", writable: false }); },
    crate => { Object.freeze(crate); }, crate => { Object.setPrototypeOf(crate, { whole: "above", extra: 1 }); delete crate.whole; }, crate => { crate.unlisted = 1; crate[7] = "seven"; },
    crate => { for (let i = 0; i < 40; i++) crate["n" + i] = i; }, crate => { crate.inner = new Crate(); late(crate.inner, 9); },
];
const said: string[] = [];
for (let turn = 0; turn < 3; turn++) for (const deed of deeds) for (const filled of [false, true]) {
    const crate = new Crate(); if (filled) late(crate, turn + 1);
    said.push(read(crate), readAround(crate, deed), read(crate), (globalThis as any).shown[1](crate), (globalThis as any).shown[2](crate, deed));
}
for (const other of [{ whole: 3 }, { text: "plain", whole: 4, more: 5 }, Object.create(new Crate()), 5, "text", [1]]) said.push((globalThis as any).shown[1](other));
for (const nothing of [undefined, null]) { try { (globalThis as any).shown[1](nothing); } catch (error) { said.push((error as Error).constructor.name); } }
console.log(said.length, said.join("|"));

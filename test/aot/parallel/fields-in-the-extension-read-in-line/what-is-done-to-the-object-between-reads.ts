class Crate { tag = 1; }
function late(crate: Crate, step: number) { (crate as any).whole = step; (crate as any).text = "t" + step; (crate as any).more = step * 2; }
function read(crate: Crate) { return String((crate as any).whole) + "," + String((crate as any).text) + "," + String((crate as any).more) + "," + String((crate as any).inner ? (crate as any).inner.whole : "none"); }
function readAround(crate: Crate, deed: (crate: any) => void) { const before = (crate as any).whole; const text = (crate as any).text; deed(crate); return [before, text, (crate as any).whole, (crate as any).text, (crate as any).more, "whole" in crate, Object.keys(crate).join("+")].map(String).join(","); }
(globalThis as any).shown = [late, read, readAround];
const deeds: ((crate: any) => void)[] = [
    () => {}, crate => { delete (crate as any).whole; }, crate => { delete (crate as any).text; (crate as any).text = "again"; }, crate => { (crate as any).whole = "a text"; }, crate => { (crate as any).whole = 1.5; }, crate => { (crate as any).whole = undefined; },
    crate => { Object.defineProperty(crate, "whole", { get() { return "got"; }, configurable: true }); }, crate => { Object.defineProperty(crate, "text", { value: "fixed", writable: false }); },
    crate => { Object.freeze(crate); }, crate => { Object.setPrototypeOf(crate, { whole: "above", extra: 1 }); delete (crate as any).whole; }, crate => { crate.unlisted = 1; crate[7] = "seven"; },
    crate => { for (let i = 0; i < 40; i++) crate["n" + i] = i; }, crate => { (crate as any).inner = new Crate(); late((crate as any).inner, 9); },
];
const said: string[] = [];
for (let turn = 0; turn < 3; turn++) for (const deed of deeds) for (const filled of [false, true]) {
    const crate = new Crate(); if (filled) late(crate, turn + 1);
    said.push(read(crate), readAround(crate, deed), read(crate), (globalThis as any).shown[1](crate), (globalThis as any).shown[2](crate, deed));
}
for (const other of [{ whole: 3 }, { text: "plain", whole: 4, more: 5 }, Object.create(new Crate()), 5, "text", [1]]) said.push((globalThis as any).shown[1](other));
for (const nothing of [undefined, null]) { try { (globalThis as any).shown[1](nothing); } catch (error) { said.push((error as Error).constructor.name); } }
console.log(said.length, said.join("|"));

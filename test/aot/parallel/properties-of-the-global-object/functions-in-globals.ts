// @ts-nocheck
// Functions that the file stores into properties of the global object, called by other functions.
const g: any = globalThis;
const list: number[] = JSON.parse("[3,1,4,1,5,9,2,6]");
function show(name: string, rounds: number, body: (round: number) => unknown): void {
  const lines: string[] = [];
  for (let round = 0; round < rounds; round++) {
    try { lines.push(String(body(round))); } catch (error) { lines.push((error as Error).name); }
  }
  console.log(name, lines.join(" "));
}
(globalThis as any).fgNext = (x: number) => x + 1;
g.fgTwice = function (x: number) { return x * 2; };
function half(x: number) { return x / 2; }
g.fgHalf = half;
g["fgOwner"] = function (this: any, x: number) { return this === globalThis ? x : -x; };
function sumOfNext() { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + (globalThis as any).fgNext(x)) | 0; } return s; }
function sumOfTwice() { let s = 0; for (let i = 0; i < list.length; i++) s += g.fgTwice(list[i]!); return s; }
function sumOfHalf() { let s = 0; for (const x of list) s += g.fgHalf(x); return s; }
function sumOfOwner() { let s = 0; for (let i = 0; i < list.length; i++) s = s * 3 + (globalThis as any).fgOwner(list[i]!); return s; }
function sumOfFree() { let s = 0; for (let i = 0; i < list.length; i++) s += fgNext(list[i]!); return s; }
show("next", 5, round => {
  if (round === 2) (globalThis as any)["fg" + "Next"] = (x: number) => "t" + x;
  if (round === 3) Object.defineProperty(globalThis, "fgNext", { configurable: true, get: () => half });
  if (round === 4) delete (globalThis as any).fgNext;
  return sumOfNext();
});
show("twice", 3, round => { if (round === 1) g[["fg", "Twice"].join("")] = half; if (round === 2) g[["fg", "Twice"].join("")] = 5; return sumOfTwice(); });
show("half", 3, round => { if (round === 1) Reflect.set(globalThis, "fgHalf", (x: number) => x * x); if (round === 2) Reflect.deleteProperty(globalThis, "fgHalf"); return sumOfHalf(); });
show("owner", 3, round => { if (round === 1) Object.assign(globalThis, { fgOwner: (x: number) => x & 1 }); if (round === 2) Object.assign(globalThis, { fgOwner: Math.sqrt }); return sumOfOwner(); });
show("free", 3, round => { if (round) Reflect.set(globalThis, "fgNext", round === 1 ? half : new Proxy(half, {})); return sumOfFree(); });

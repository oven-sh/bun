type Box = { w: number; h: number; tag: string };
function area(box: Box): number { return box.w * box.h + box.tag.length; }
function sum(kept: Box[], count: number) { let total = 0; for (let i = 0; i < count; i++) total += area(kept[i]); return total; }
function make(count: number): Box[] { const kept: Box[] = []; for (let i = 0; i < count; i++) kept.push({ w: i, h: i + 1, tag: "t" }); (globalThis as any).kept = kept; return kept; }
function show(run: () => unknown) { try { console.log(String(run())); } catch (e) { console.log((e as Error).constructor.name); } }
(globalThis as any).seen = [area];
(0, eval)("1");
const kept = make(64);
let reads = 0;
Object.defineProperty(kept[31], "h", { get() { reads++; return 2; } });
for (let round = 0; round < 5; round++) show(() => sum(kept, 64) + ":" + reads);

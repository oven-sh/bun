type Box = { w: number; h: number; tag: string };
function area(box: Box): number { return box.w * box.h + box.tag.length; }
function sum(kept: Box[], count: number) { let total = 0; for (let i = 0; i < count; i++) total += area(kept[i]); return total; }
function make(count: number): Box[] { const kept: Box[] = []; for (let i = 0; i < count; i++) kept.push({ w: i, h: i + 1, tag: "t" }); (globalThis as any).kept = kept; return kept; }
function show(run: () => unknown) { try { console.log(String(run())); } catch (e) { console.log((e as Error).constructor.name); } }
(globalThis as any).seen = [area];
(0, eval)("1");
const kept = make(64);
for (let round = 0; round < 5; round++) {
  if (round === 1) delete (kept[9] as any).h;
  if (round === 2) kept[9].h = 4;
  if (round === 3) Object.setPrototypeOf(kept[11], { extra: 1 });
  show(() => sum(kept, 64));
}

interface Node { name: string; size: number; kids: Node[]; box: { w: number; h: number; at: number[] } }
function tree(): Node {
  return { name: "root", size: 1, box: { w: 1, h: 2, at: [0, 0] }, kids: [
    { name: "a", size: 2, box: { w: 3, h: 4, at: [1, 1] }, kids: [{ name: "a1", size: 3, box: { w: 5, h: 6, at: [2, 2] }, kids: [] }, { name: "a2", size: 4, box: { w: 7, h: 8, at: [3, 3] }, kids: [] }] },
    { name: "b", size: 5, box: { w: 9, h: 10, at: [4, 4] }, kids: [{ name: "b1", size: 6, box: { w: 11, h: 12, at: [5, 5] }, kids: [{ name: "b11", size: 7, box: { w: 13, h: 14, at: [6, 6] }, kids: [] }] }] },
  ] };
}
function deep(): any { return [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[{ bottom: ["here", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] }]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]; }
const count = (n: Node): number => n.size + n.box.w + n.box.h + n.box.at[0] + n.name.length + n.kids.reduce((s, k) => s + count(k), 0);
const kept: Node[] = []; let total = 0;
for (let round = 0; round < 8; round++) {
  for (let i = 0; i < 4000; i++) {
    const t = tree(); total += count(t);
    if (i % 500 === 0) kept.push(t.kids[1].kids[0], t.kids[0]);
    if (i % 700 === 0) { t.kids[0].kids.push(tree()); t.box.at.push(i); t.kids[1].box = { w: i, h: i, at: [i] }; kept.push(t); }
  }
  Bun.gc(true);
  for (const k of kept) total += count(k);
}
console.log(total, kept.length, JSON.stringify(tree()).length, JSON.stringify(kept).length);
let d = deep(), levels = 0; while (Array.isArray(d)) { d = d[0]; levels++; } console.log(levels, d.bottom.join());
const many: any[] = []; for (let i = 0; i < 3000; i++) many.push(deep()); Bun.gc(true); let ok = 0; for (const m of many) { let x = m; while (Array.isArray(x)) x = x[0]; ok += x.bottom.length; } console.log(ok);

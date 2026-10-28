// An old outer object; a young string and a young object are stored through the alias of the inner one; then Eden collections.
interface Leaf { v: number }
interface Inner { d: number; s: string; leaf: Leaf | null }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i, s: "old", leaf: null } }; }
const outers: Outer[] = [];
for (let i = 0; i < 5000; i++) outers.push(make(i));
Bun.gc(true); Bun.gc(true);
const aliases: Inner[] = outers.map(o => o.c);
function garbage(n: number): number { let x = 0; for (let i = 0; i < n; i++) x += ({ v: i, w: "g" + i }).w.length; return x; }
let g = 0;
for (let round = 0; round < 8; round++) {
  for (let i = 0; i < aliases.length; i++) {
    aliases[i].s = "young" + round + "-" + i;
    aliases[i].leaf = { v: round * 100000 + i };
  }
  g += garbage(200000);
  Bun.gc(false);
}
let sum = 0, text = 0;
for (const o of outers) { sum += o.c.leaf!.v; text += o.c.s.length; }
console.log(sum, text, g, aliases[17] === outers[17].c);

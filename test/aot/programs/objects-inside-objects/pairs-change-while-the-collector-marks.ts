// A large heap of pairs, so that marking takes long, and a program that never stops changing them: values stored into the inner objects, inner objects wanted for themselves, replaced by new ones and exchanged.
import { edenGC, fullGC } from "bun:jsc";

type Leaf = (number | Leaf | null)[];
type Inner = { count: number; leaf: Leaf | null; text: string | null };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, leaf: null, text: null }, tag: i });
    }
  }
}

let seed = 12345;
function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % limit;
}

const held: Inner[] = [];
function hold(outer: Outer): void { held.push(outer.inner); }
function exchange(x: Outer, y: Outer): void { const kept = x.inner; x.inner = y.inner; y.inner = kept; }

function storeLeaf(outer: Outer, step: number): void {
  const inner = outer.inner;
  inner.leaf = [step, inner.leaf && step % 4 ? inner.leaf : null];
  inner.count = step;
}
function storeText(outer: Outer, step: number): void {
  outer.inner.text = "text" + step;
}
function renew(outer: Outer, step: number): void {
  outer.inner = { count: -step, leaf: [-step, null], text: null };
}
function depth(leaf: Leaf | null): number { let n = 0; while (leaf && n < 1000) { n++; leaf = leaf[1] as Leaf | null; } return n; }

const outers: Outer[] = [];
fill(outers, 200, 200);
const n = outers.length;
let sum = 0;
let step = 0;
for (let round = 0; round < 600; round++) {
  for (let turn = 0; turn < 500; turn++) {
    step++;
    const outer = outers[random(n)];
    switch (random(12)) {
    case 0: case 1: case 2: case 3: case 4: storeLeaf(outer, step); break;
    case 5: case 6: case 7: storeText(outer, step); break;
    case 8: case 9: renew(outer, step); break;
    default: sum = (sum + outer.inner.count + depth(outer.inner.leaf) + (outer.inner.text ? outer.inner.text.length : 0)) | 0;
    }
  }
  hold(outers[random(n)]);
  exchange(outers[random(n)], outers[random(n)]);
  if (held.length > 300) held.length = 100;
  if (round % 150 === 149) edenGC();
}
fullGC();
let check = 0, none = 0;
for (const outer of outers) {
  const inner = outer.inner;
  check = (check * 31 + inner.count + depth(inner.leaf) * 7 + (inner.leaf ? (inner.leaf[0] as number) : 1) + (inner.text ? inner.text.length + Number(inner.text.slice(4)) : 3)) | 0;
}
for (const inner of held) check = (check * 31 + inner.count + depth(inner.leaf)) | 0;
console.log(sum, check, none, held.length);

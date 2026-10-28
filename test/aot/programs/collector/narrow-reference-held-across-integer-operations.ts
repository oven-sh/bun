// A reference loaded from a field stays a 32-bit cell number across integer arithmetic, comparisons and in-bounds array reads while nothing else holds the object. Where a collection can run in between, a pointer must stand beside it.
// The .json asks the build to prove that, and turns off the collector's scan for 32-bit cell numbers.
const collect: () => void = typeof (globalThis as any).gc === "function" ? (globalThis as any).gc : () => Bun.gc(true);

class Link { next: Link | undefined = undefined; other: Link | undefined = undefined; flags = 0; }

let calls = 0, checksum = 0;
function churn(): void {
  if (++calls % 3 === 0) collect();
  const scratch: Link[] = [];
  for (let i = 0; i < 12; i++) { const made = new Link(); made.flags = i; scratch.push(made); }
}

const weights = [3, 5, 7, 11];

function moveAcrossIntegerTest(from: Link, to: Link) { const p = from.next; if (p === undefined) return; from.next = undefined; if ((from.flags & 8) === 0) return; to.other = p; }
function moveAcrossArithmetic(from: Link, to: Link, k: number) { const p = from.next; if (p === undefined) return; from.next = undefined; const w = ((from.flags * 3 + k) | 0) % 5; if (w < 0) return; checksum += w; to.other = p; }
function moveAcrossArrayRead(from: Link, to: Link, k: number) { const p = from.next; if (p === undefined) return; from.next = undefined; const w = weights[k & 3]; if (w === 4) return; checksum += w; to.other = p; }
function moveAcrossCollection(from: Link, to: Link) { const p = from.next; if (p === undefined) return; from.next = undefined; if ((from.flags & 8) === 0) return; churn(); to.other = p; }
function moveAcrossUntypedArithmetic(from: Link, to: Link, k: any) { const p = from.next; if (p === undefined) return; from.next = undefined; const w = k * 2; if (w === 4) return; to.other = p; }
function moveThroughJoin(from: Link, to: Link, first: boolean) { const p = first ? from.next : from.other; from.next = undefined; from.other = undefined; if ((from.flags & 8) === 0) return; if (p === undefined) return; to.other = p; }

const collectingNumber = { valueOf() { churn(); return 3; } };
const sources: Link[] = [], targets: Link[] = [];
for (let i = 0; i < 60; i++) {
  const from = new Link(), moved = new Link(), spare = new Link();
  from.flags = 8 | (i << 4);
  moved.flags = 2000 + i;
  spare.flags = 3000 + i;
  from.next = moved;
  from.other = spare;
  sources.push(from);
  targets.push(new Link());
}
for (let i = 0; i < 60; i += 6) {
  moveAcrossIntegerTest(sources[i], targets[i]);
  churn();
  moveAcrossArithmetic(sources[i + 1], targets[i + 1], i);
  churn();
  moveAcrossArrayRead(sources[i + 2], targets[i + 2], i);
  churn();
  moveAcrossCollection(sources[i + 3], targets[i + 3]);
  churn();
  moveAcrossUntypedArithmetic(sources[i + 4], targets[i + 4], i & 8 ? collectingNumber : i);
  churn();
  moveThroughJoin(sources[i + 5], targets[i + 5], (i & 4) === 4);
  churn();
}
const out: number[] = [];
for (let i = 0; i < 60; i++) { const moved = targets[i].other; out.push(moved === undefined ? -1 : moved.flags); }
console.log(out.join(" "), checksum);

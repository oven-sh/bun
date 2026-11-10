// Env: BUN_JSC_markedBlockCageSizeInMB=64
// A hundred thousand numbers, spread evenly over all that 32 bits can say, lie in frames while a queue turns over in a full heap. None of them is a reference:
// whoever takes one for a reference to a link that the queue has dropped keeps every later link, and the heap runs full.
class Leaf {
  constructor(text) {
    this.text = text;
  }
}
class Link {
  constructor(left, right, id) {
    this.left = left;
    this.right = right;
    this.id = id;
    this.next = null;
  }
}
const leaves = [new Leaf("a"), new Leaf("b"), new Leaf("c")];
let oldest = new Link(leaves[0], leaves[1], 0);
let newest = oldest;
function push() {
  const id = newest.id + 1;
  const link = new Link(leaves[id % 3], leaves[(id + 1) % 3], id);
  newest.next = link;
  newest = link;
}
function grow(count) {
  for (let i = 0; i < count; i++) push();
}
function turn(count) {
  for (let i = 0; i < count; i++) {
    push();
    oldest = oldest.next;
  }
}
function isFull(run, count) {
  try {
    run(count);
    return false;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return true;
  }
}
function wrong() {
  let count = 0;
  for (let link = oldest; link; link = link.next) {
    if (link.left !== leaves[link.id % 3] || link.right !== leaves[(link.id + 1) % 3] || (link.next && link.next.id !== link.id + 1)) count++;
  }
  return count;
}
function work() {
  isFull(grow, 1_200_000);
  let total = wrong();
  for (let cycle = 0; cycle < 40; cycle++) {
    if (isFull(turn, 50_000)) {
      for (let i = 0; i < 1000; i++) oldest = oldest.next;
    }
    if (cycle % 8 === 7) total += wrong();
  }
  return total + wrong();
}
let sum = 0;
function hold(first, step, depth) {
  const a = first | 0;
  const b = (a + step) | 0;
  const c = (b + step) | 0;
  const d = (c + step) | 0;
  const e = (d + step) | 0;
  const f = (e + step) | 0;
  const g = (f + step) | 0;
  const h = (g + step) | 0;
  const result = depth > 0 ? hold((h + step) | 0, step, depth - 1) : work();
  sum = (sum + (a ^ b ^ c ^ d ^ e ^ f ^ g ^ h)) | 0;
  return result;
}
const frames = 12_500;
console.log("wrong", hold(0, Math.floor(2 ** 32 / (frames * 8)), frames), "sum", sum);

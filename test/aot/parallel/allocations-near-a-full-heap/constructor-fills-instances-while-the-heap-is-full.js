// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the cell that an allocation hands on is looked at
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
isFull(grow, 1_200_000);
let total = wrong();
for (let cycle = 0; cycle < 40; cycle++) {
  if (isFull(turn, 50_000)) {
    for (let i = 0; i < 1000; i++) oldest = oldest.next;
  }
  if (cycle % 8 === 7) total += wrong();
}
console.log("wrong", total + wrong());

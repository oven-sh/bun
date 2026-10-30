// Makes classes while the heap is full, lets everything go and makes one more.
// Plain Bun has no heap limit, so each loop also stops at a fixed count.
// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Alone: how much fits in the 64 MB heap depends on what else the executable holds
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get sum() {
    return this.x + this.y;
  }
}
function local() {
  return class Local extends Point {
    #hidden = 3;
    static count = 0;
    get all() {
      return this.sum + this.#hidden + ++Local.count;
    }
  };
}
let held = [];
function fill() {
  for (let made = 0; made < 1_500_000; made += 1024) {
    const items = [];
    held.push(items);
    for (let at = 0; at < 1024; at++) items.push([at, made]);
  }
}
function makeClasses() {
  for (let made = 0; made < 3000; made++) held.push(local());
}
for (const step of [fill, makeClasses, makeClasses, makeClasses]) {
  try {
    step();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}
held = null;
console.log(new (local())(1, 2).all);

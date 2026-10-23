// Objects, closures and results that live in frames make frames larger. A recursion that plain Bun carries to its end must still reach it, each level must find its own objects when the levels below have returned, and what one level in a thousand keeps must be whole.
interface Level {
  depth: number;
  tag: string;
  below: number;
}
const kept: Level[] = [];
const keptReads: (() => string)[] = [];
function measure(level: Level): number {
  return level.depth + level.tag.length;
}
function call<T>(f: () => T): T {
  return f();
}
function makeLevel(depth: number): Level {
  return { depth, tag: "level " + depth, below: 0 };
}
function descend(depth: number, limit: number): number {
  const mine = makeLevel(depth);
  const pair = { a: depth, b: depth * 2 };
  const list = [depth, depth + 1];
  let local = depth;
  const read = () => mine.tag + "/" + local;
  if (depth < limit) mine.below = descend(depth + 1, limit);
  local++;
  if (depth % 1000 === 999) {
    kept.push(mine);
    keptReads.push(read);
  }
  return (mine.below + measure(mine) + pair.a + pair.b + list[1] + call(read).length) % 1000003;
}
console.log(descend(0, 6000));
Bun.gc(true);
console.log(kept.map(k => k.tag + ":" + k.below).join(" "));
console.log(keptReads.map(r => r()).join(" "));

// Two functions in turn, each with a fresh result of the other in hand.
function ping(depth: number): { sum: number; deepest: number } {
  if (depth === 0) return { sum: 0, deepest: 0 };
  const below = pong(depth - 1);
  return { sum: below.sum + depth, deepest: below.deepest + 1 };
}
function pong(depth: number): { sum: number; deepest: number } {
  if (depth === 0) return { sum: 0, deepest: 0 };
  const below = ping(depth - 1);
  const mine = { sum: below.sum - 1, deepest: below.deepest + 1 };
  return mine;
}
const bottom = ping(5000);
console.log(bottom.sum, bottom.deepest);

// The recursion runs through a callback of a built-in and through a closure made at every level.
function viaForEach(depth: number, report: (d: number) => void): void {
  const here = { depth };
  [0].forEach(() => {
    if (here.depth > 0) viaForEach(here.depth - 1, d => report(d + 1));
    else report(0);
  });
}
let reported = -1;
viaForEach(1500, d => {
  reported = d;
});
console.log(reported);

// A stack that really overflows is caught, and the frames above are intact.
function endless(n: number, carried: { count: number }): number {
  const mine = { n };
  carried.count++;
  return endless(n + 1, carried) + mine.n;
}
function survives(): string {
  const before = { tag: "made before the overflow" };
  const carried = { count: 0 };
  const read = () => before.tag;
  try {
    endless(0, carried);
    return "no overflow";
  } catch (error) {
    return (error as Error).constructor.name + " " + (carried.count > 1000) + " " + call(read);
  }
}
console.log(survives(), survives());

// An inner function that its siblings call is never made as an object. Here siblings also hand it on as a value, and the function that declares it never does:
// the first sibling that hands it on makes the object, and everybody after it gets the same one. Built without inlining, so that the reads stay in the siblings.
function declares(n: number, otherFirst: boolean) {
  let calls = 0;
  const first = otherFirst ? other(n) : give(n);
  return [first, give(0), other(1), give(2), callOnly(n + 4), calls] as const;

  function target(x: number): number {
    calls++;
    return x <= 0 ? n : target(x - 1) + 1;
  }
  function give(depth: number): (x: number) => number {
    calls++;
    return depth > 0 ? give(depth - 1) : target;
  }
  function other(depth: number): (x: number) => number {
    calls++;
    return depth > 0 ? other(depth - 1) : target;
  }
  function callOnly(x: number): number {
    calls++;
    return x > 3 ? callOnly(x - 1) : target(x) * 2;
  }
}
const results = [declares(1, false), declares(2, true), declares(0, false)];
for (const [a, b, c, d, called, calls] of results) console.log(a === b && b === c && c === d, a(3), called, calls);
console.log(results[0][0] === results[1][0], results[1][0] === results[2][0]);

// The object keeps what is put on it, and it outlives the activation together with the scope it reads.
function keepsProperties(seed: number) {
  let total = seed;
  mark();
  return [read(), hand()] as const;

  function counted(step: number) {
    total += step;
    return total;
  }
  function hand() {
    return counted;
  }
  function mark() {
    (hand() as { tag?: string }).tag = "tag" + seed;
  }
  function read() {
    return (hand() as { tag?: string }).tag;
  }
}
const [tag, later] = keepsProperties(10);
console.log(tag, later(1), later(2), (later as { tag?: string }).tag, later.name, later.length);

// An activation in which nobody hands it on makes none, and a collection between two reads changes nothing.
function sometimes(hands: boolean, n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += step(i);
  if (!hands) return sum;
  const before = pass();
  Bun.gc(true);
  return before === pass() ? sum + before(1) : -1;

  function step(i: number): number {
    return i > 2 ? step(i - 2) + n : i;
  }
  function pass() {
    return step;
  }
}
let all = 0;
for (let i = 0; i < 3000; i++) all += sometimes(i % 1000 === 0, i % 7);
console.log(all);

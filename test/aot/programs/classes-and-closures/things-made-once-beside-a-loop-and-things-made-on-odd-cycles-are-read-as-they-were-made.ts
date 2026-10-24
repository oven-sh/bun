type Reader = (thing: () => () => number) => number;
const other = () => () => -1;
function readOne(thing: () => () => number) { return thing()(); }
const readers: Reader[] = [readOne, thing => thing()(), thing => readOne.call(undefined, thing), thing => Reflect.apply(readOne, undefined, [thing])];

function inFrontOfALoop(n: number, pick: boolean) {
  const seen: number[] = [];
  const base = n * 7;
  const maker = () => () => base;
  for (let i = 0; i < n; i++) seen.push(readOne(pick ? maker : other) + i);
  for (const read of readers) for (let i = 0; i < n; i++) seen.push(read(maker) + i);
  return seen;
}
function madeInOneArmInFrontOfALoop(n: number, pick: boolean) {
  const seen: number[] = [];
  let maker = other;
  if (pick) { const base = n + 40; maker = () => () => base; }
  for (let i = 0; i < n; i++) seen.push(readOne(maker) + i);
  return seen;
}
function sumOf(pair: { first: number; second: number }) { return pair.first * 100 + pair.second; }
function whichOf(record: object) { return "first" in record ? 10 : "sort" in record ? 100 : -1000; }
function lengthOf(...rest: number[]) { let sum = rest.length * 1000; for (let i = 0; i < 3; i++) for (const each of rest) sum += each; return sum; }
function objectsAndLists(n: number) {
  const seen: number[] = [];
  const pair = { first: n, second: n + 1 };
  const list = [n, n + 2, n + 4];
  for (let i = 0; i < n; i++) seen.push(sumOf(pair) + whichOf(pair) + list[i % 3] + lengthOf(n, i));
  return seen;
}
function behindALoop(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  const maker = () => () => sum;
  const pair = { first: sum, second: n };
  return [readOne(maker), sumOf(pair), whichOf(pair)];
}
function inTheArmThatLeaves(n: number) {
  for (let i = 0; ; i++) {
    if (i === n) { const maker = () => () => i * 3; return readOne(maker); }
  }
}
function throughACatch(n: number) {
  const seen: number[] = [];
  let tries = 0;
  for (;;) {
    try {
      const now = tries;
      const maker = () => () => now;
      seen.push(readOne(maker));
      if (++tries < n) throw new Error("again");
      break;
    } catch { continue; }
  }
  return seen;
}
function throughAFinally(n: number) {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) {
    try { if (i % 2) continue; seen.push(-i); }
    finally { const maker = () => () => i; seen.push(readOne(maker)); }
  }
  return seen;
}
function callsItselfLast(n: number, seen: number[], maker: () => () => number): number[] {
  seen.push(readOne(maker));
  if (!n) return seen;
  return callsItselfLast(n - 1, seen, () => () => n);
}
function small(i: number) { const maker = () => () => i + 5; return readOne(maker); }
function smaller(i: number) { return small(i) + small(i + 1); }
function pastedIntoALoop(n: number) {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) seen.push(small(i), smaller(i));
  return seen;
}
async function betweenTwoAwaits(n: number) {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) {
    await null;
    const maker = () => () => i;
    seen.push(readOne(maker));
    await null;
  }
  return seen;
}
function* betweenTwoYields(n: number) {
  for (let i = 0; i < n; i++) {
    yield -i;
    const maker = () => () => i;
    yield readOne(maker);
  }
}
function stateMachine(n: number) {
  const seen: number[] = [];
  let state = 0, i = 0;
  while (true) {
    switch (state) {
      case 0: { const maker = () => () => i; seen.push(readOne(maker)); state = 1; break; }
      case 1: { const pair = { first: i, second: state }; seen.push(sumOf(pair)); state = ++i < n ? 0 : 2; break; }
      default: return seen;
    }
  }
}
async function once() {
  return [
    inFrontOfALoop(3, true), inFrontOfALoop(3, false), madeInOneArmInFrontOfALoop(3, true), madeInOneArmInFrontOfALoop(3, false), objectsAndLists(4), behindALoop(4), inTheArmThatLeaves(5),
    throughACatch(3), throughAFinally(4), callsItselfLast(3, [], other), pastedIntoALoop(3), await betweenTwoAwaits(3), [...betweenTwoYields(3)], stateMachine(3),
  ].map(String).join(" | ");
}
console.log(await once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = await once();
console.log(last);

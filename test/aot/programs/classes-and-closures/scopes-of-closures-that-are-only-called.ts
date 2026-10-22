// A function answers with a closure over a scope of its own, and the caller only calls the closure and drops it: the caller is then the last to have the scope.
// Beside each such caller stands one that keeps the closure now and then, hands it on, or has two of them at once.
function make(start: number) {
  let count = start;
  if (start > 100) count -= 100;
  return (step: number) => (count += step);
}
function onlyCalls(start: number) {
  const next = make(start);
  return next(1) + next(2);
}
function twoAtOnce(a: number, b: number) {
  const first = make(a);
  const second = make(b);
  return [first(1), second(1), first(1), second(10), first(100)].join();
}
const keptNowAndThen: ((step: number) => number)[] = [];
function keepsNowAndThen(rounds: number) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const next = make(i);
    sum += next(1);
    if (i % 7 === 0) keptNowAndThen.push(next);
    sum += next(1);
  }
  return sum;
}
function answersWithItSometimes(start: number, hand: boolean) {
  const next = make(start);
  next(5);
  return hand ? next : null;
}
function holder(next: (step: number) => number, into: unknown[]): number {
  into.push(next);
  return into.length > 1000 ? holder(next, []) : into.length;
}
function handsItToAKeeper(start: number, into: unknown[]) {
  const next = make(start);
  next(3);
  return holder(next, into);
}
function borrower(next: (step: number) => number, times: number): number {
  return times > 0 ? next(1) + borrower(next, times - 1) : 0;
}
function handsItToABorrower(start: number) {
  const next = make(start);
  return borrower(next, 3) + next(0);
}
function callsItselfInBetween(depth: number): string {
  const next = make(depth * 10);
  next(1);
  const below = depth > 0 ? callsItselfInBetween(depth - 1) : "";
  return next(1) + ";" + below;
}
function handsItToNativeCode(start: number) {
  const next = make(start);
  return [1, 2, 3].map(next).join();
}
function throwsInBetween(start: number) {
  const next = make(start);
  try {
    if (next(1) % 2) throw next;
    return "even " + next(0);
  } catch (thrown) {
    return "odd " + (thrown as typeof next)(0);
  }
}
// The maker is itself only a link: it answers with what another maker answered.
function makeThrough(start: number) {
  return start % 2 ? make(start) : make(start + 1000);
}
function onlyCallsThrough(start: number) {
  const next = makeThrough(start);
  return next(1) + next(1);
}
// An object of closures in place of one closure.
function makePair(start: number) {
  let count = start;
  if (start > 100) count -= 100;
  return { up: () => ++count, down: () => --count };
}
function onlyCallsPair(start: number) {
  const pair = makePair(start);
  return pair.up() + pair.up() + pair.down();
}
const keptPairs: { up: () => number; down: () => number }[] = [];
function keepsOneMember(start: number) {
  const pair = makePair(start);
  pair.up();
  keptPairs.push({ up: pair.up, down: makePair(start + 1).down });
  return pair.down();
}

const out: unknown[] = [];
for (let i = 0; i < 5; i++) out.push(onlyCalls(i * 3));
out.push(twoAtOnce(1, 50), twoAtOnce(200, 7));
out.push(keepsNowAndThen(50), keptNowAndThen.map(f => f(0)).join());
const handed = [answersWithItSometimes(1, true), answersWithItSometimes(2, false), answersWithItSometimes(3, true), answersWithItSometimes(4, true)];
out.push(handed.map(f => (f ? f(0) : "-")).join());
const keeper: ((step: number) => number)[] = [];
for (let i = 0; i < 4; i++) out.push(handsItToAKeeper(i * 2, keeper));
out.push(keeper.map(f => f(0)).join());
for (let i = 0; i < 3; i++) out.push(handsItToABorrower(i * 5));
out.push(callsItselfInBetween(4), handsItToNativeCode(3), handsItToNativeCode(9));
for (let i = 0; i < 4; i++) out.push(throwsInBetween(i));
for (let i = 0; i < 4; i++) out.push(onlyCallsThrough(i));
for (let i = 0; i < 3; i++) out.push(onlyCallsPair(i * 4), keepsOneMember(i * 4));
out.push(keptPairs.map(p => p.up() + "/" + p.down()).join());
console.log(out.join(" | "));
let total = 0;
for (let i = 0; i < 20000; i++) total += onlyCalls(i) + onlyCallsPair(i) + onlyCallsThrough(i) + handsItToABorrower(i);
console.log(total, keptNowAndThen.map(f => f(0)).join(), keeper.map(f => f(0)).join(), keptPairs.map(p => p.up()).join());

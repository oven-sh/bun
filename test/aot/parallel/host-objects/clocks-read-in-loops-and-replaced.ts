// STATISTIC: NativeFunctionsCalledDirectly >= 5
// performance.now() and Bun.nanoseconds(): numbers that never fall, read in a loop, through a variable, on another receiver, and after the program has put a function of its own in their place.
function readings(count: number): string {
  let last = 0;
  let falls = 0;
  let others = 0;
  for (let i = 0; i < count; i++) {
    const now = performance.now();
    if (typeof now !== "number" || !(now > 0) || !Number.isFinite(now)) others++;
    if (now < last) falls++;
    last = now;
  }
  return `${falls} ${others}`;
}
function nanoseconds(count: number): string {
  let last = 0;
  let falls = 0;
  let others = 0;
  for (let i = 0; i < count; i++) {
    const now = Bun.nanoseconds();
    if (typeof now !== "number" || !(now > 0) || !Number.isInteger(now)) others++;
    if (now < last) falls++;
    last = now;
  }
  return `${falls} ${others}`;
}
console.log("now", readings(2000), "nanoseconds", nanoseconds(2000));

function elapsed(start: number): number {
  return performance.now() - start;
}
const start = performance.now();
let spent = 0;
for (let i = 0; i < 1000; i++) spent = elapsed(start);
console.log("elapsed", spent >= 0, spent < 60_000, Bun.nanoseconds() / 1e6 >= spent);

const kept: unknown[] = [];
for (let i = 0; i < 3; i++) kept.push(performance.now(), Bun.nanoseconds());
console.log("kept", kept.map(value => typeof value).join());

const borrowed = performance.now;
console.log("borrowed", typeof borrowed(), typeof borrowed.call({}), typeof Reflect.apply(Bun.nanoseconds, undefined, []));
console.log("operands", typeof (performance.now as (...rest: unknown[]) => number)(1, "two", {}), performance.now.length, performance.now.name, Bun.nanoseconds.length, Bun.nanoseconds.name);

function read(): number {
  return performance.now();
}
let before = 0;
for (let i = 0; i < 100; i++) before = read();
performance.now = () => -5;
let after = 0;
for (let i = 0; i < 100; i++) after = read();
console.log("replaced", before > 0, after);

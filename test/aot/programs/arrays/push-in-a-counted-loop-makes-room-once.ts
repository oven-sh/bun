// `for (let i = 0; i < n; i++) out.push(..)`: when the vector is full, the slow path makes room for all the turns that are left, whatever kind of number n is. A push that is not made in every turn, or a loop with a second way out, grows step by step.
declare const aotOperationCount: undefined | ((name: string) => number);
const slowPushes = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTArrayPush") + aotOperationCount("operationAOTArrayPushNumber") : 0;
function measured(what: string, atMost: number, atLeast: number, run: () => unknown[]): void {
  const before = slowPushes();
  const made = run();
  const calls = slowPushes() - before;
  const isCompiled = typeof aotOperationCount === "function";
  let sum = 0;
  for (let i = 0; i < made.length; i += 997) sum += typeof made[i] === "number" ? (made[i] as number) : (made[i] as { at: number }).at;
  console.log(what, made.length, sum, !isCompiled || (calls <= atMost && calls >= atLeast) ? "as expected" : "slow pushes: " + calls);
}
function wholeNumbers(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i * 3);
  return out;
}
function fractions(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i + 0.5);
  return out;
}
function records(n: number): { at: number }[] {
  const out: { at: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ at: i });
  return out;
}
function boundWorkedOutInTheTest(scale: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.floor(50000 * scale); i++) out.push(i);
  return out;
}
function startsLater(n: number): number[] {
  const out: number[] = [1, 2, 3];
  for (let i = 7; i < n; i++) out.push(i);
  return out;
}
function everyOther(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (i & 1) out.push(i);
  return out;
}
function leavesEarly(n: number, last: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i);
    if (i === last) break;
  }
  return out;
}
function throwsEarly(n: number, last: number): number[] {
  const out: number[] = [];
  try {
    fill(out, n, last);
  } catch {}
  return out;
}
function fill(out: number[], n: number, last: number): void {
  for (let i = 0; i < n; i++) {
    out.push(i);
    check(i, last);
  }
}
function check(i: number, last: number): void {
  if (i === last) throw new RangeError("far enough");
}
function anotherArrayEveryThousandTurns(n: number): number[] {
  const parts: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (i % 1000 === 0) parts.push([]);
    parts[parts.length - 1]!.push(i);
  }
  return parts[parts.length - 1]!;
}
function fewAtATimeOntoALongArray(rounds: number, each: number): number[] {
  const out: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < each; i++) out.push(round + i);
  }
  return out;
}
const half = Number("0.5");
measured("whole numbers", 2, 1, () => wholeNumbers(Number("100000")));
measured("a bound that is no whole number", 2, 1, () => wholeNumbers(99999 + half));
measured("fractions", 2, 1, () => fractions(Number("100000")));
measured("records", 2, 1, () => records(Number("100000")));
measured("the bound is worked out in the test", 2, 1, () => boundWorkedOutInTheTest(half * 4));
measured("starts later, on an array that holds something", 2, 1, () => startsLater(Number("60000")));
measured("few", 2, 0, () => wholeNumbers(Number("3")));
measured("none", 0, 0, () => wholeNumbers(Number("0")));
measured("a negative bound", 0, 0, () => wholeNumbers(Number("-5")));
measured("not a number", 0, 0, () => wholeNumbers(Number("x")));
measured("every other turn", 100, 3, () => everyOther(Number("100000")));
measured("another array every thousand turns", 100000, 200, () => anotherArrayEveryThousandTurns(Number("100000")));
measured("few at a time onto a long array", 60, 3, () => fewAtATimeOntoALongArray(Number("20000"), Number("5")));
measured("leaves early", 100, 0, () => leavesEarly(Infinity, 5000));
measured("throws early under a great bound", 100, 0, () => throwsEarly(1e15, 5000));
measured("throws early", 100, 0, () => throwsEarly(Number("3000000"), 50));

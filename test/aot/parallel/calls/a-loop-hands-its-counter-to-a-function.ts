// `for (let i = 0; i < n; i++) use(i)` where nobody knows what number `n` is. The counter is a whole number however far the loop goes: at 2 ** 53 a step of one is lost
// to rounding and the counter stays there. What is handed to `use` takes remainders, finds elements and keys, is printed, divided and stored. The same at the top level,
// in a function, in a method and in a field, up and down, from zero and from next to 2 ** 53, and beside counters that are no such numbers: steps of two, fractions, -0.
export {};

const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
}
const few = Number(process.env.NOBODY_SETS_THIS || 12);
const endless = Number(process.env.NOBODY_SETS_THIS || Infinity);
const fraction = Number(process.env.NOBODY_SETS_THIS || 4.5);
const notANumber = Number(process.env.NOBODY_SETS_THIS || "no");

const ranks = new Map<number, number>();
for (let i = 0; i < 40; i++) ranks.set(i * 3, i);
const letters = ["a", "b", "c", "d", "e"];

function rankOf(i: number): number {
  return ranks.get((i % 10) * 3) ?? -1;
}
function letterAt(i: number): string {
  return letters[i] ?? "-";
}
function letterRound(i: number): string {
  return letters[i % 5]!;
}
function half(i: number): number {
  return i / 2;
}
function next(i: number): number {
  return i + 1;
}
function twoOn(i: number): number {
  return i + 2;
}
function before(i: number): number {
  return i - 1;
}
function lowBits(i: number): number {
  return i & 7;
}
function asText(i: number): string {
  return "<" + i + ">";
}
function isWhole(i: number): boolean {
  return Number.isInteger(i) && !Object.is(i, -0);
}
function isSafe(i: number): boolean {
  return Number.isSafeInteger(i);
}
const kept: number[] = [];
function keep(i: number): number {
  kept.push(i);
  return kept.length;
}
// A function that calls itself stays a function wherever it is called: what it is handed arrives in a parameter.
function below(i: number, depth: number): string {
  if (depth > 0) return below(i, depth - 1);
  return [
    ranks.get((i % 10) * 3) ?? -1,
    letters[i] ?? "-",
    letters[i % 5],
    i / 2,
    i + 1,
    i + 2,
    i - 1,
    i - 2,
    i * 2,
    -i,
    i & 7,
    i | 0,
    i >>> 0,
    Math.floor(i / 2),
    "<" + i + ">",
    Number.isInteger(i),
    Object.is(i, -0),
    Number.isSafeInteger(i),
    i === 9007199254740992,
    i < 9007199254740992,
    i > -9007199254740992,
    i + 1 === i,
    i - 1 === i,
  ].join(",");
}
function all(i: number): string {
  return [rankOf(i), letterAt(i), letterRound(i), half(i), next(i), twoOn(i), before(i), lowBits(i), asText(i), isWhole(i), isSafe(i), keep(i)].join(",");
}

// At the top level.
{
  let sum = 0;
  let text = "";
  for (let i = 0; i < few; i++) {
    sum += rankOf(i);
    text += letterAt(i) + letterRound(i);
  }
  report("top level", sum, text);
  const seen: string[] = [];
  for (let i = 0; i < fraction; i++) seen.push(all(i) + ";" + below(i, 1));
  report("up to a fraction", ...seen);
  let turns = 0;
  for (let i = 0; i < notANumber; i++) turns += next(i);
  report("up to no number", turns);
}

// In a function.
function countUp(from: number, to: number, most: number): string[] {
  const seen: string[] = [];
  for (let i = from; i < to; i++) {
    seen.push(all(i) + ";" + below(i, 1));
    if (seen.length >= most) break;
  }
  return seen;
}
function countDown(from: number, to: number, most: number): string[] {
  const seen: string[] = [];
  for (let i = from; i > to; i--) {
    seen.push(all(i) + ";" + below(i, 1));
    if (seen.length >= most) break;
  }
  return seen;
}
report("a function, up", ...countUp(0, few, 100));
report("a function, down", ...countDown(3, -few, 100));

// Written starts: the build knows them.
function upFromNextToTheEnd(to: number): string[] {
  const seen: string[] = [];
  for (let i = 9007199254740989; i < to; i++) {
    seen.push(all(i) + ";" + below(i, 1));
    if (seen.length >= 7) break;
  }
  return seen;
}
function downFromNextToTheEnd(to: number): string[] {
  const seen: string[] = [];
  for (let i = -9007199254740989; i > to; i--) {
    seen.push(all(i) + ";" + below(i, 1));
    if (seen.length >= 7) break;
  }
  return seen;
}
report("up past 2 ** 53", ...upFromNextToTheEnd(endless));
report("down past -(2 ** 53)", ...downFromNextToTheEnd(-endless));

// The other ways to write a step of one.
function stepsWrittenOut(to: number): string[] {
  const seen: string[] = [];
  for (let i = 9007199254740990; i < to; i += 1) {
    seen.push(asText(i) + next(i) + lowBits(i) + below(i, 1));
    if (seen.length >= 5) break;
  }
  for (let i = 9007199254740990; i < to; i = i + 1) {
    seen.push(asText(i) + next(i) + lowBits(i) + below(i, 1));
    if (seen.length >= 10) break;
  }
  for (let i = 9007199254740990; i < to; i = 1 + i) {
    seen.push(asText(i) + next(i) + lowBits(i) + below(i, 1));
    if (seen.length >= 15) break;
  }
  for (let i = -9007199254740990; i > -to; i -= 1) {
    seen.push(asText(i) + before(i) + lowBits(i) + below(i, 2));
    if (seen.length >= 20) break;
  }
  for (let i = -9007199254740990; i > -to; i = i - 1) {
    seen.push(asText(i) + before(i) + lowBits(i) + below(i, 2));
    if (seen.length >= 25) break;
  }
  for (let i = -9007199254740990; i > -to; i += -1) {
    seen.push(asText(i) + before(i) + lowBits(i) + below(i, 2));
    if (seen.length >= 30) break;
  }
  let i = 9007199254740990;
  while (i < to) {
    seen.push(asText(i) + next(i) + lowBits(i) + below(i, 1));
    ++i;
    if (seen.length >= 35) break;
  }
  return seen;
}
report("steps written out", ...stepsWrittenOut(endless));

// No steps of one: these pass 2 ** 53, or are no whole numbers at all.
function belowOthers(i: number, depth: number): string {
  if (depth > 0) return belowOthers(i, depth - 1);
  return [i % 10, letters[i] ?? "-", i / 2, i + 1, i - 1, i & 7, i | 0, "<" + i + ">", Number.isInteger(i), Object.is(i, -0), Number.isSafeInteger(i), i + 1 === i].join(",");
}
function otherSteps(to: number): string[] {
  const seen: string[] = [];
  for (let i = 9007199254740988; i < to; i += 2) {
    seen.push(asText(i) + next(i) + isSafe(i) + letterRound(i) + belowOthers(i, 1));
    if (seen.length >= 6) break;
  }
  for (let i = 4503599627370496; i < to; i *= 2) {
    seen.push(asText(i) + next(i) + isSafe(i) + rankOf(i) + belowOthers(i, 1));
    if (seen.length >= 12) break;
  }
  for (let i = 0.5; i < to; i++) {
    seen.push(asText(i) + isWhole(i) + letterAt(i) + lowBits(i) + belowOthers(i, 1));
    if (seen.length >= 16) break;
  }
  for (let i = -0; i < to; i++) {
    seen.push(asText(i) + isWhole(i) + letterAt(i) + half(i) + belowOthers(i, 1));
    if (seen.length >= 19) break;
  }
  for (let i = 0; i < to; i += 0.25) {
    seen.push(asText(i) + isWhole(i) + letterAt(i) + rankOf(i) + belowOthers(i, 1));
    if (seen.length >= 25) break;
  }
  for (let i = 3; i > -to; i--) {
    seen.push(asText(i * 0) + isWhole(i * 0) + asText(i % 3) + isWhole(i % 3));
    if (seen.length >= 32) break;
  }
  return seen;
}
report("other steps", ...otherSteps(endless));

// What is reckoned from the counter is handed over.
function belowReckoned(i: number, depth: number): string {
  if (depth > 0) return belowReckoned(i, depth - 1);
  return "(" + [i, Object.is(i, -0), 1 / i, letters[i] ?? "-", i % 3, i + 1].join(",") + ")";
}
function reckoned(to: number): string[] {
  const seen: string[] = [];
  for (let i = 9007199254740988; i < to; i++) {
    seen.push([asText(i - 5), asText(i + 5), asText(i * 2), asText(i % 7), asText(-i), asText(i >>> 0), asText(i | 0), asText(Math.floor(i / 2))].join(""));
    if (seen.length >= 6) break;
  }
  for (let i = 2; i > -to; i--) {
    seen.push([asText(i % 2), isWhole(i % 2), asText(i * 0), isWhole(-i), letterAt(-i), rankOf(-i), belowReckoned(i % 2, 1), belowReckoned(i * 0, 1), belowReckoned(-i, 1), belowReckoned(i - 5, 1)].join(""));
    if (seen.length >= 11) break;
  }
  return seen;
}
report("reckoned from the counter", ...reckoned(endless));

// In a method and in a field.
class Walk {
  seenAtBirth: string[] = (() => {
    const seen: string[] = [];
    for (let i = 9007199254740990; i < endless; i++) {
      seen.push(all(i) + ";" + below(i, 1));
      if (seen.length >= 4) break;
    }
    for (let i = 0; i < few; i++) seen.push(letterRound(i) + rankOf(i));
    return seen;
  })();
  constructor(readonly to: number) {}
  rank(i: number): number {
    return ranks.get((i % 10) * 3) ?? -1;
  }
  walk(): number {
    let sum = 0;
    for (let i = 0; i < this.to; i++) sum += this.rank(i) + lowBits(i);
    return sum;
  }
  walkFromTheEnd(): string[] {
    const seen: string[] = [];
    for (let i = 9007199254740990; i < this.to; i++) {
      seen.push(this.rank(i) + asText(i));
      if (seen.length >= 5) break;
    }
    return seen;
  }
}
report("a field", ...new Walk(few).seenAtBirth);
report("a method", new Walk(few).walk(), new Walk(fraction).walk(), new Walk(notANumber).walk(), new Walk(-few).walk());
report("a method, from the end", ...new Walk(endless).walkFromTheEnd());

// One function is handed counters by some and other numbers by others.
function mixed(i: number): string {
  return asTextOfMixed(i) + (i % 4);
}
function asTextOfMixed(i: number): string {
  return "[" + i + "]";
}
{
  const seen: string[] = [];
  for (let i = 0; i < fraction; i++) seen.push(mixed(i));
  seen.push(mixed(0.75), mixed(-0), mixed(1e300), mixed(NaN), mixed(-Infinity));
  report("counters and other numbers", ...seen);
}

// A function that calls itself hands the counter on, a closure keeps it, a loop in a loop counts from it.
function handedOn(i: number, depth: number): number {
  if (depth > 0) return handedOn(i, depth - 1);
  return (i % 1000) * 7;
}
{
  let sum = 0;
  const later: (() => string)[] = [];
  for (let i = 0; i < few; i++) {
    sum += handedOn(i, 2);
    later.push(() => asText(i) + letterRound(i));
    for (let k = i; k < fraction; k++) sum += lowBits(k) + rankOf(k);
  }
  report("handed on", sum, ...later.map(run => run()));
}

report("kept", kept.length, kept.slice(0, 8).join(), kept.slice(-8).join());
console.log(lines.join("\n"));

// At 2 ** 53 a step of one is lost to rounding: 2 ** 53 + 1 is 2 ** 53 again, and 2 ** 53 - 1 is exact. Counters of every kind are stepped across both ends.
const top = 9007199254740992;
const lines: string[] = [];
function show(name: string, values: unknown[]) {
  lines.push(name + ": " + values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
}

let up = 9007199254740989;
function stepUp() {
  return up++;
}
let upPrefix = 9007199254740989;
function stepUpPrefix() {
  return ++upPrefix;
}
let upAssign = 9007199254740989;
function stepUpAssign() {
  upAssign += 1;
  return upAssign;
}
let upSum = 9007199254740989;
function stepUpSum() {
  upSum = upSum + 1;
  return upSum;
}
let upSumLeft = 9007199254740989;
function stepUpSumLeft() {
  upSumLeft = 1 + upSumLeft;
  return upSumLeft;
}
let upMinusMinus = 9007199254740989;
function stepUpMinusMinus() {
  upMinusMinus -= -1;
  return upMinusMinus;
}

let down = -9007199254740989;
function stepDown() {
  return down--;
}
let downPrefix = -9007199254740989;
function stepDownPrefix() {
  return --downPrefix;
}
let downAssign = -9007199254740989;
function stepDownAssign() {
  downAssign -= 1;
  return downAssign;
}
let downSum = -9007199254740989;
function stepDownSum() {
  downSum = downSum + -1;
  return downSum;
}

let both = 9007199254740990;
function bothUp() {
  return ++both;
}
function bothDown() {
  return --both;
}

function makeCounter(start: number) {
  let n = start;
  return { up: () => n++, down: () => n--, now: () => n };
}
const captured = makeCounter(9007199254740990);
const capturedLow = makeCounter(-9007199254740990);

class Ticket {
  static issued = 9007199254740989;
  static next() {
    return Ticket.issued++;
  }
}
class Meter {
  count = 9007199254740989;
  tick() {
    return this.count++;
  }
}
const meter = new Meter();

let across32 = 2147483645;
function stepAcross32() {
  return across32++;
}
let acrossMinus32 = -2147483646;
function stepAcrossMinus32() {
  return acrossMinus32--;
}
let acrossU32 = 4294967293;
function stepAcrossU32() {
  return ++acrossU32;
}
let throughZero = -2;
function stepThroughZero() {
  return ++throughZero;
}
let downThroughZero = 2;
function stepDownThroughZero() {
  return --downThroughZero;
}

// Counters that lean on each other: one takes what the other holds, and a pair takes from each other.
let taker = 9007199254740990;
let giver = -9007199254740990;
function stepTaker() {
  return ++taker;
}
function stepGiver() {
  return --giver;
}
function takeFromGiver() {
  taker = giver;
  return taker;
}
let left = 9007199254740990;
let right = -9007199254740990;
function stepLeft() {
  return ++left;
}
function stepRight() {
  return --right;
}
function leftFromRight() {
  left = right;
  return left;
}
function rightFromLeft() {
  right = left;
  return right;
}

// Many environments, one captured variable.
const many: Array<() => number> = [];
for (let i = 0; i < 3; i++) {
  let n = 9007199254740989 + i;
  many.push(() => n++);
}

// Only stepped and compared, and read once at the end.
let tries = 9007199254740989;
function tryAgain() {
  return ++tries < 9007199254740992;
}

// Not counters: each of these leaves the exact integers, or was never inside.
let byTwo = 9007199254740988;
function stepByTwo() {
  byTwo += 2;
  return byTwo;
}
let beyond = 9007199254740994;
function stepBeyond() {
  return ++beyond;
}
let fraction = 0.5;
function stepFraction() {
  return ++fraction;
}
let minusZero = -0;
function readMinusZero() {
  const before = minusZero;
  minusZero++;
  return before;
}
let reset = 9007199254740990;
function stepReset(to: number) {
  if (to) reset = to;
  return ++reset;
}
var early: number;
function stepEarly() {
  return ++early;
}
const beforeEarly = stepEarly();
early = 5;
let text: any = "7";
function stepText() {
  return text++;
}
let big: any = 9007199254740991n;
function stepBig() {
  return ++big;
}
let nothing: any = null;
function stepNothing() {
  return ++nothing;
}

const six = [0, 1, 2, 3, 4, 5];
for (const [name, step] of Object.entries({
  stepUp,
  stepUpPrefix,
  stepUpAssign,
  stepUpSum,
  stepUpSumLeft,
  stepUpMinusMinus,
  stepDown,
  stepDownPrefix,
  stepDownAssign,
  stepDownSum,
  stepAcross32,
  stepAcrossMinus32,
  stepAcrossU32,
  stepThroughZero,
  stepDownThroughZero,
  stepByTwo,
  stepBeyond,
  stepFraction,
  readMinusZero,
  stepEarly,
  stepText,
  stepBig,
  stepNothing,
}))
  show(
    name,
    six.map(() => step()),
  );
show("both", [
  bothUp(),
  bothUp(),
  bothUp(),
  bothUp(),
  bothDown(),
  bothDown(),
  bothUp(),
  bothUp(),
  bothUp(),
  bothDown(),
]);
show("captured", [
  captured.up(),
  captured.up(),
  captured.up(),
  captured.up(),
  captured.now(),
  captured.down(),
  captured.now(),
  captured.up(),
  captured.up(),
  captured.now(),
]);
show("capturedLow", [
  capturedLow.down(),
  capturedLow.down(),
  capturedLow.down(),
  capturedLow.down(),
  capturedLow.now(),
  capturedLow.up(),
  capturedLow.now(),
]);
show("taker", [
  stepTaker(),
  stepTaker(),
  stepTaker(),
  stepGiver(),
  stepGiver(),
  stepGiver(),
  takeFromGiver(),
  stepTaker(),
  stepTaker(),
  stepGiver(),
  takeFromGiver(),
  stepTaker(),
]);
show("pair", [
  stepLeft(),
  stepLeft(),
  stepLeft(),
  rightFromLeft(),
  stepRight(),
  stepRight(),
  stepLeft(),
  stepRight(),
  leftFromRight(),
  stepLeft(),
  stepLeft(),
  stepLeft(),
  stepLeft(),
]);
show(
  "many",
  many.flatMap(step => [step(), step(), step(), step(), step()]),
);
show("tries", [tryAgain(), tryAgain(), tryAgain(), tryAgain(), tries]);
show("static", six.map(() => Ticket.next()).concat(Ticket.issued));
show("instance", six.map(() => meter.tick()).concat(meter.count));
show("reset", [
  stepReset(0),
  stepReset(0),
  stepReset(0),
  stepReset(1.5),
  stepReset(0),
  stepReset(9007199254740996),
  stepReset(0),
  stepReset(-0.5),
  stepReset(0),
]);
show("beforeEarly", [beforeEarly]);
show("at the end", [
  up,
  upPrefix,
  upAssign,
  upSum,
  upSumLeft,
  upMinusMinus,
  down,
  downPrefix,
  downAssign,
  downSum,
  both,
  across32,
  acrossMinus32,
  acrossU32,
  throughZero,
  downThroughZero,
  byTwo,
  beyond,
  fraction,
  minusZero,
  reset,
  early,
  text,
  big,
  nothing,
]);
// What is done with the number: bits, an index, a key, a text, a sum, a comparison, a division.
show("uses", [
  up & 7,
  up | 0,
  up >>> 0,
  up % 10,
  up + 1,
  up + 2,
  up - 1,
  up * 2,
  up / 2,
  up === top,
  up > top - 1,
  String(up),
  `${up}`,
  [1, 2, 3][across32 & 1],
  { [up]: 1 }[top],
  JSON.stringify({ up }),
  Number.isSafeInteger(up),
  Number.isInteger(up),
  typeof up,
  -down === up,
]);
console.log(lines.join("\n"));

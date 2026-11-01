// value = (value * 31 + 7) % 1000003 in a loop, where `value` is a number that nothing proves whole: whole, fractional, negative, minus zero, huge and no number at all,
// sums, differences, products and negations under the remainder, and values that stop being whole, or get too large for exact arithmetic, on the way.
function text(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function timesThirtyOnePlusSeven(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * 31 + 7) % 1000003;
  return value;
}
function plusTheRound(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value + round) % 1000000007;
  return value;
}
function minusTheRound(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value - round) % 5;
  return value;
}
function timesMinusThreePlusTen(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * -3 + 10) % 7;
  return value;
}
function timesMinusOne(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * -1) % 5;
  return value;
}
function timesMinusOneTimesThree(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * -1 * 3) % 5;
  return value;
}
function timesMinusOneMinusTheRound(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * -1 - (round >> 4)) % 5;
  return value;
}
function timesMinusOnePlusTheRound(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * -1 + (round >> 4)) % 5;
  return value;
}
function negated(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = -value % 3;
  return value;
}
function nineMinus(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (9 - value) % 4;
  return value;
}
function alone(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value % 1000) + 999;
  return value;
}
function squaredPlusOne(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * value + 1) % 65537;
  return value;
}
function squaredUnderALargeDivisor(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * value + 1) % 4294967291;
  return value;
}
function timesAMillionUnderAHugeDivisor(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * 1048576 + 1) % 9007199254740881;
  return value;
}
function plusTwoToTheFiftyTwo(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value + 4503599627370496) % 9007199254740991;
  return value;
}
function plusTwoToTheFiftyThree(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value + 9007199254740992) % 9007199254740991;
  return value;
}
function twoRemaindersARound(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) {
    const middle = (value * 31 + 7) % 1000003;
    value = (middle * 17 + 3) % 65521;
  }
  return value;
}
function alsoReadAsANumber(rounds: number, first: number): number {
  let value = first;
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    value = (value * 31 + 7) % 1000003;
    total += value / 3;
  }
  return total;
}
function halfAddedNowAndThen(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) {
    if (round % 5 === 3) value += 0.5;
    if (round % 5 === 0) value = Math.floor(value);
    value = (value * 3 + 1) % 1009;
  }
  return value;
}
function oneArmOfTwo(rounds: number, first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = round % 3 === 1 ? value + 0.25 : (value * 2 + 1) % 1001;
  return value;
}
function untilItIsSmall(rounds: number, first: number): number {
  let value = first;
  let steps = 0;
  while (steps < rounds && !(value >= 0 && value < 10)) {
    value = (value * 7 + 3) % 1013;
    steps++;
  }
  return value * 1000 + steps;
}

const firsts: number[] = [
  5, 0, -0, 1, -1, -5, 0.5, -0.5, 1 / 31, 7 / 3, 1000002, 1000003, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 4294967297,
  2 ** 47, 2 ** 48 - 1, 2 ** 48, 2 ** 48 + 1, -(2 ** 48), 2 ** 51, 2 ** 52, 2 ** 52 + 1, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 62, 2 ** 63, -(2 ** 63), 2 ** 64,
  1e21, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity,
];
const allRounds: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 11, 40];
const ofOneNumber: [string, (rounds: number, first: number) => number][] = [
  ["value * 31 + 7", timesThirtyOnePlusSeven],
  ["value + round", plusTheRound],
  ["value - round", minusTheRound],
  ["value * -3 + 10", timesMinusThreePlusTen],
  ["value * -1", timesMinusOne],
  ["value * -1 * 3", timesMinusOneTimesThree],
  ["value * -1 - (round >> 4)", timesMinusOneMinusTheRound],
  ["value * -1 + (round >> 4)", timesMinusOnePlusTheRound],
  ["-value", negated],
  ["9 - value", nineMinus],
  ["value", alone],
  ["value * value + 1", squaredPlusOne],
  ["value * value + 1, large divisor", squaredUnderALargeDivisor],
  ["value * 1048576 + 1", timesAMillionUnderAHugeDivisor],
  ["value + 2 ** 52", plusTwoToTheFiftyTwo],
  ["value + 2 ** 53", plusTwoToTheFiftyThree],
  ["two remainders", twoRemaindersARound],
  ["also read as a number", alsoReadAsANumber],
  ["half added now and then", halfAddedNowAndThen],
  ["one arm of two", oneArmOfTwo],
  ["until it is small", untilItIsSmall],
];
for (const [name, run] of ofOneNumber) {
  for (const first of firsts) console.log(name, text(first), allRounds.map(rounds => text(run(rounds, first))).join(" "));
}

function timesAFactor(rounds: number, first: number, factor: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * factor) % 1000;
  return value;
}
function timesAFactorPlusOne(rounds: number, first: number, factor: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * factor + 1) % 1000;
  return value;
}
function plusAnAddend(rounds: number, first: number, addend: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value + addend) % 360;
  return value;
}
function underADivisor(rounds: number, first: number, divisor: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * 3 + 1) % divisor;
  return value;
}
function plusASquare(rounds: number, first: number, side: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value + side * side) % 1000;
  return value;
}
function plusHalfOfANumber(rounds: number, first: number, doubled: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * 3 + doubled * 0.5) % 1000;
  return value;
}
function plusADifference(rounds: number, first: number, from: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value * 3 + (from - round)) % 1000;
  return value;
}
function minusAProduct(rounds: number, first: number, factor: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) value = (value - factor * round) % 1000;
  return value;
}
const seconds: number[] = [0, -0, 1, -1, 2, 3, -3, 7, 0.5, -0.25, 1000, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 2 ** 40, 2 ** 53, 1e300, NaN, Infinity, -Infinity];
const ofTwoNumbers: [string, (rounds: number, first: number, second: number) => number][] = [
  ["value * factor", timesAFactor],
  ["value * factor + 1", timesAFactorPlusOne],
  ["value + addend", plusAnAddend],
  ["% divisor", underADivisor],
  ["value + side * side", plusASquare],
  ["value * 3 + doubled * 0.5", plusHalfOfANumber],
  ["value * 3 + (from - round)", plusADifference],
  ["value - factor * round", minusAProduct],
];
for (const [name, run] of ofTwoNumbers) {
  for (const first of [5, 0, -0, -4, 0.5, 999, 2 ** 31, 2 ** 52, NaN]) {
    for (const second of seconds) console.log(name, text(first), text(second), [0, 1, 2, 3, 4, 9].map(rounds => text(run(rounds, first, second))).join(" "));
  }
}

function checksum(rounds: number, list: number[], first: number): number {
  let value = first;
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < list.length; index++) value = (value * 31 + list[index]) % 1000003;
  }
  return value;
}
const lists: number[][] = [
  [],
  [1, 2, 3, 4, 5, 6, 7],
  [1, 2, 3.5, 4, 5],
  [0.5, 0.5, 1, 2],
  [1, -0, 2, -0],
  [-1, -2, -3],
  [-7, 0, 0, 0],
  [1, 2, NaN, 3],
  [1, Infinity, 3],
  [2147483647, 2147483648, -2147483648, -2147483649],
  [2 ** 40, 2 ** 52, 2 ** 53, 2 ** 53 + 2, 1e300],
];
for (const list of lists) {
  for (const first of [5, 0, -0, -3, 0.5, 2 ** 48, NaN]) console.log("checksum", list.map(text).join(","), text(first), [0, 1, 2, 3].map(rounds => text(checksum(rounds, list, first))).join(" "));
}

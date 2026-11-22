// STATISTIC: SplitProductsWidened >= 2
// STATISTIC: PresenceChecksFusedIntoRangeChecks >= 2
// A purse holds more than a word, in rolls of 2^24 coins, the smallest first, and all of it is worth so and so many times itself: a roll is taken in an upper part and a lower one, what is over goes into the next roll, and nothing
// on the way leaves 32 bits. Other purses are cut at other places. What is no roll (holes, fractions, words, numbers below zero or past the roll) is worth what the text says.
"use strict";
function worth(purse, times) {
  const rate = times & 16383;
  let over = 0;
  for (let roll = 0; roll < purse.length; roll++) {
    const coins = purse[roll];
    const upper = (coins >> 12) * rate;
    const sum = (coins & 4095) * rate + ((upper & 4095) << 12) + over;
    over = (sum >> 24) + (upper >> 12);
    purse[roll] = sum & 16777215;
  }
  return over;
}
function worthOfShort(purse, times) {
  const rate = times & 16383;
  let over = 0;
  for (let roll = 0; roll < purse.length; roll++) {
    const coins = purse[roll];
    const upper = (coins >> 10) * rate;
    const sum = (coins & 1023) * rate + ((upper & 1023) << 10) + over;
    over = (sum >> 20) + (upper >> 10);
    purse[roll] = sum & 1048575;
  }
  return over;
}
// the rest of another purse is laid beside it
function worthBeside(purse, gains, times) {
  const rate = times & 16383;
  let over = 0;
  for (let roll = 0; roll < purse.length; roll++) {
    const coins = purse[roll];
    const upper = (coins >> 12) * rate;
    const sum = (coins & 4095) * rate + ((upper & 4095) << 12) + gains[roll] + over;
    over = (sum >> 24) + (upper >> 12);
    gains[roll] = sum & 16777215;
  }
  return over;
}
// the same, told by whole numbers that are as long as they must be
function told(purse, times, bits) {
  let over = 0n;
  const rolls = [];
  for (const coins of purse) {
    const sum = BigInt(coins) * BigInt(times & 16383) + over;
    over = sum >> BigInt(bits);
    rolls.push(Number(sum & ((1n << BigInt(bits)) - 1n)));
  }
  return [Number(over), rolls];
}
const long = [], short = [], gains = [];
for (let roll = 0; roll < 41; roll++) {
  long.push((roll * 1234567 + 1) & 16777215);
  short.push((roll * 7654321 + 2) & 1048575);
  gains.push((roll * 3456789) & 16777215);
}
let last = 0, wrong = 0;
for (let day = 0; day < 300; day++) {
  const times = 16383 - day * 7;
  const [over, rolls] = told(long, times, 24), [overOfShort, shortRolls] = told(short, times, 20);
  const said = worth(long, times), saidOfShort = worthOfShort(short, times);
  if (said !== over || saidOfShort !== overOfShort || rolls.some((coins, roll) => coins !== long[roll]) || shortRolls.some((coins, roll) => coins !== short[roll])) wrong++;
  last = (last + said + saidOfShort + worthBeside(long, gains, times)) | 0;
}
console.log(wrong, last, long.join(), short.join(), gains.join());
const tell = value => (Object.is(value, -0) ? "-0" : String(value));
const tried = work => {
  try {
    return tell(work());
  } catch (error) {
    return error.name;
  }
};
const purses = {
  "none": () => [],
  "one roll": () => [16777215],
  "full": () => new Array(9).fill(16777215),
  "larger": () => [16777216, 2147483647, 5],
  "negative": () => [-1, -4096, -16777216, 7],
  "a late one below zero": () => [1, 2, 3, 4, 5, 6, 7, -8, 9],
  "a late hole": () => [1, 2, 3, 4, 5, , 7, 8, 9],
  "over a word": () => [4294967297, 2 ** 40, 2 ** 53],
  "fractions": () => [1.9, 4095.5, -0.5, 16777214.75],
  "minus zero": () => [-0, 1, -0],
  "words": () => ["12", "4096", "x", ""],
  "nothing": () => [undefined, null, NaN, true],
  "a view": () => new Int32Array([1, -1, 2147483647]),
  "bytes": () => new Uint8Array([255, 1, 254]),
  "floats": () => new Float64Array([1.5, 2 ** 31, -7]),
  "frozen": () => Object.freeze([1, 2, 3]),
  "objects": () => [{ valueOf: () => 4097 }, 3],
  "bigs": () => [1n, 2],
  "a word": () => "123",
};
const rates = [0, 1, 3, 16383, 16384, -1, 2.5, "77", NaN, 2 ** 31, undefined];
for (const [name, make] of Object.entries(purses)) {
  for (const rate of rates) {
    const one = make(), two = make(), three = make(), beside = [5, 16777215, 7, 8, , 9, 10, 11, 12];
    console.log(name, tell(rate), tried(() => worth(one, rate)), tried(() => Array.from(one).map(tell)), tried(() => worthOfShort(two, rate)), tried(() => Array.from(two).map(tell)), tried(() => worthBeside(three, beside, rate)), Array.from(beside).map(tell).join());
  }
}

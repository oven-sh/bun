// `count += isSet ? 1 : 0`, `sum += word & 7`: the loop counts up to a number, and what a turn adds lies between two small integers. The sum is kept as an integer.
function howManyAreOdd(turns) {
  let count = 0;
  for (let i = 0; i < turns; i++) count += (i & 1) === 1 ? 1 : 0;
  return count;
}
function lowBits(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += i & 7;
  return sum;
}
function upAndDown(turns) {
  let sum = 5;
  for (let i = 0; i < turns; i++) sum -= (i % 3) - 1;
  return sum;
}
function behindWhatIsAdded(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (i & 3) + sum;
  return sum;
}
function pastInt32(turns) {
  let sum = 2147483000;
  for (let i = 0; i < turns; i++) sum += (i & 1023) | 512;
  return sum;
}
function belowInt32(turns) {
  let sum = -2147483000;
  for (let i = 0; i < turns; i++) sum -= (i & 1023) | 512;
  return sum;
}
function seenUnderACondition(turns) {
  let sum = 0, seen = 0;
  for (let i = 0; i < turns; i++) {
    sum += i & 3;
    if ((i & 5) === 5) seen = sum;
  }
  return sum + "," + seen;
}
function storedInEveryTurn(turns) {
  const sums = new Int32Array(16);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += i & 3;
    sums[i & 15] = sum;
  }
  return sum + ":" + sums.join("");
}
function whereTheMostWasAdded(turns) {
  const values = Int16Array.of(1, 5, 9, 3, 9, 2, 0, 4);
  let sum = 0, at = -1, most = -1;
  for (let i = 0; i < turns; i++) {
    const added = values[i & 7] & 3;
    sum += added;
    if (added > most) {
      most = added;
      at = sum;
    }
  }
  return sum + "," + at + "," + most;
}
const all = [howManyAreOdd, lowBits, upAndDown, behindWhatIsAdded, pastInt32, belowInt32, seenUnderACondition, storedInEveryTurn, whereTheMostWasAdded];
for (const turns of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 24, 1000, 100001, -1, 2.5, 1e3 + 0.5, NaN, -0, -Infinity, 2 ** 31 - 2 ** 31 + 7])
  console.log(String(turns), ...all.map(count => count(turns)));
console.log(Object.is(howManyAreOdd(0), 0), Object.is(lowBits(-0), 0), 1 / upAndDown(0));

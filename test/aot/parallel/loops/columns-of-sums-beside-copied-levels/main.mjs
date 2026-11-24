// STATISTIC: ViewSumNests >= 9
// STATISTIC: ElementPairsCopiedAsWords >= 9
// Columns of sums over a window of readings. Behind its sum each column copies two levels that lie beside each other, and puts one of them, the other one or both there again: raised by the sum, or the sum itself. The levels are of 16 bits with and without a sign, read in both orders and stored in both orders, one column behind the other and two levels a column.
const size = 128;
const mask = 31;
const levels = new Int16Array(size), into = new Int16Array(size);
const words = new Uint16Array(size), intoWords = new Uint16Array(size);
const readings = new Int16Array(size), numbers = new Float64Array(size);
// The tables of weights are longer than the window. A column takes twelve of them.
const weights = new Int16Array(size), weightsOfNumbers = new Float64Array(size);
for (let place = 0; place < size; place++) {
  levels[place] = (place * 7919 - 20011) | 0;
  words[place] = (place * 5501 + 60013) | 0;
  readings[place] = ((place * 37) % 101) - 50;
  numbers[place] = ((place * 53) % 89) - 44;
  weights[place] = ((place * 29) % 23) - 11;
  weightsOfNumbers[place] = ((place * 31) % 19) - 9.5;
}
function raiseSecond(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column + 1] = high + sum;
  }
}
function raiseFirstInTheOtherOrder(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const behind = column + 1;
    const high = levels[behind], low = levels[column];
    into[behind] = high;
    into[column] = low;
    into[column] = low - sum;
  }
}
function sumInPlaceOfSecond(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column + 1] = sum >> 2;
  }
}
function raiseFirst(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column] = low + sum;
  }
}
function sumInPlaceOfFirst(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const high = levels[column + 1], low = levels[column];
    into[column] = low;
    into[column + 1] = high;
    into[column] = sum;
  }
}
function raiseBoth(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column] = low - (sum >> 4);
    into[column + 1] = high + (sum >> 3);
  }
}
function raiseSecondTwice(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column + 1] = high + sum;
    into[column + 1] = high - sum;
  }
}
function keepBoth(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column + 2] = sum;
  }
}
function raiseSecondOfTwo(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const at = 2 * column;
    const low = levels[at], high = levels[at + 1];
    into[at] = low;
    into[at + 1] = high;
    into[at + 1] = high + sum;
  }
}
function raiseSecondWithNumbers(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0.5;
    for (let term = 0; term < 12; term++) sum += weightsOfNumbers[term] * numbers[column + term];
    const low = levels[column], high = levels[column + 1];
    into[column] = low;
    into[column + 1] = high;
    into[column + 1] = high + sum;
  }
}
function raiseSecondOfWords(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = words[column], high = words[column + 1];
    intoWords[column] = low;
    intoWords[column + 1] = high;
    intoWords[column + 1] = high + sum;
  }
}
function raiseFirstOfWordsWithNumbers(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0.5;
    for (let term = 0; term < 12; term++) sum += weightsOfNumbers[term] * numbers[column + term];
    const high = words[column + 1], low = words[column];
    intoWords[column + 1] = high;
    intoWords[column] = low;
    intoWords[column] = low + sum;
  }
}
function raiseSecondInPlace(count) {
  const columns = count & mask;
  for (let column = 0; column < columns; column++) {
    let sum = 0;
    for (let term = 0; term < 12; term++) sum = (sum + Math.imul(weights[term], readings[column + term])) | 0;
    const low = levels[column], high = levels[column + 1];
    levels[column] = low;
    levels[column + 1] = high;
    levels[column + 1] = high + sum;
  }
}

for (const count of (process.argv[2] ?? "3 4 7 8 13 16 22 31").split(" ").map(Number)) {
  into.fill(0);
  raiseSecond(count);
  console.log("raiseSecond", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseFirstInTheOtherOrder(count);
  console.log("raiseFirstInTheOtherOrder", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  sumInPlaceOfSecond(count);
  console.log("sumInPlaceOfSecond", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseFirst(count);
  console.log("raiseFirst", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  sumInPlaceOfFirst(count);
  console.log("sumInPlaceOfFirst", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseBoth(count);
  console.log("raiseBoth", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseSecondTwice(count);
  console.log("raiseSecondTwice", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  keepBoth(count);
  console.log("keepBoth", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseSecondOfTwo(count);
  console.log("raiseSecondOfTwo", count, into.subarray(0, 2 * count + 3).join(" "));
  into.fill(0);
  raiseSecondWithNumbers(count);
  console.log("raiseSecondWithNumbers", count, into.subarray(0, 2 * count + 3).join(" "));
  intoWords.fill(0);
  raiseSecondOfWords(count);
  console.log("raiseSecondOfWords", count, intoWords.subarray(0, 2 * count + 3).join(" "));
  intoWords.fill(0);
  raiseFirstOfWordsWithNumbers(count);
  console.log("raiseFirstOfWordsWithNumbers", count, intoWords.subarray(0, 2 * count + 3).join(" "));
  raiseSecondInPlace(count);
  console.log("raiseSecondInPlace", count, levels.subarray(0, 2 * count + 3).join(" "));
}

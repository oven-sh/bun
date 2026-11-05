// Loops in which a turn now and then takes an arm that the compiler calls unlikely and comes back for the rest of the turn: the length of a text that is still in
// pieces, a number that is a fraction among whole ones, an element that is not there. Beside it: turns that change the list, so that what was read in front of the
// loop no longer holds.
function pieces(i) {
  return "piece-" + i + "-" + "x".repeat(i % 7) + (i * 31);
}
function listOf(count, everyNth) {
  const texts = [];
  for (let i = 0; i < count; i++) texts.push(i % everyNth === 0 ? pieces(i) : ["flat", "text", "of", "letters"][i & 3]);
  return texts;
}

function lengthsByText(texts) {
  const lengths = new Map();
  for (const text of texts) lengths.set(text, text.length);
  return lengths;
}
function sumOfLengths(texts) {
  let sum = 0;
  for (const text of texts) sum += text.length;
  return sum;
}
function sumByIndex(texts) {
  let sum = 0;
  let longest = 0;
  for (let i = 0; i < texts.length; i++) {
    const length = texts[i].length;
    if (length > longest) longest = length;
    sum = (sum * 3 + length + i) | 0;
  }
  return sum + ":" + longest;
}
function twoTextsATurn(first, second) {
  let sum = 0;
  for (let i = 0; i < first.length; i++) sum = (sum + first[i].length * 5 + second[i].length) | 0;
  return sum;
}
function growsWhileWalked(texts, limit) {
  const seen = new Map();
  for (const text of texts) {
    seen.set(text, text.length);
    if (text.length > 12 && texts.length < limit) texts.push("more" + texts.length);
  }
  return seen.size + ":" + texts.length;
}
function shrinksWhileWalked(texts) {
  let sum = 0;
  for (let i = 0; i < texts.length; i++) {
    sum += texts[i].length;
    if (texts[i].length > 14) texts.length = texts.length - 1;
  }
  return sum + ":" + texts.length;
}
function lengthsOrNothing(texts, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const text = texts[i];
    sum += text === undefined ? 1000 : text.length;
  }
  return sum;
}
function sumOfNumbers(numbers) {
  const sums = new Map();
  let sum = 0;
  for (const number of numbers) {
    sum += number;
    sums.set(number, sum);
  }
  return sum + ":" + sums.size;
}
function lastLength(texts) {
  let last = -1;
  let before = -1;
  for (const text of texts) {
    before = last;
    last = text.length;
  }
  return before + ":" + last;
}

for (const everyNth of [1, 2, 3, 5, 16, 1000]) {
  let line = "every " + everyNth + ":";
  for (let turn = 0; turn < 3; turn++) {
    const lengths = lengthsByText(listOf(40, everyNth));
    let sum = 0;
    for (const [text, length] of lengths) sum += length + text.length;
    line += " " + lengths.size + "/" + sum;
  }
  line += " " + sumOfLengths(listOf(41, everyNth)) + " " + sumByIndex(listOf(37, everyNth));
  line += " " + twoTextsATurn(listOf(33, everyNth), listOf(33, everyNth + 1));
  line += " " + growsWhileWalked(listOf(30, everyNth), 45) + " " + shrinksWhileWalked(listOf(30, everyNth));
  line += " " + lastLength(listOf(29, everyNth));
  console.log(line);
}

const holed = listOf(20, 3);
delete holed[4];
delete holed[9];
console.log(lengthsOrNothing(holed, 24), lengthsOrNothing(listOf(8, 2), 8), lengthsOrNothing([], 3));
try {
  console.log(sumByIndex(holed));
} catch (error) {
  console.log(error instanceof TypeError);
}

const numbers = [];
for (let i = 0; i < 60; i++) numbers.push(i % 11 === 0 ? i + 0.5 : i);
console.log(sumOfNumbers(numbers), sumOfNumbers([1, 2, 3]), sumOfNumbers([0.5, -0, NaN, 2 ** 31, -(2 ** 31) - 1]));

let total = 0;
for (let turn = 0; turn < 20000; turn++) total = (total + sumOfLengths(listOf(6, (turn % 4) + 1)) + lengthsByText(listOf(5, (turn % 3) + 1)).size) | 0;
console.log(total);

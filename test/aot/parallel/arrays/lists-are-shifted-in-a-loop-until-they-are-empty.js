// `list.shift()` in a loop until the list is empty: every element moves down by one place in each turn. Lists of every
// length from 0 to 40, of fractions, whole numbers, texts and a mix, with NaN, -0 and holes among them. What comes out,
// and what is left after each step, is printed as a sum.
function drainNumbers(list) {
  let sum = 0;
  let steps = 0;
  for (let first = list.shift(); list.length > 0 || first !== undefined; first = list.shift()) {
    steps++;
    if (first === first && first !== undefined) sum += first * steps;
    const last = list[list.length - 1];
    if (last === last && last !== undefined) sum += last;
    if (steps > 100) break;
  }
  return `${steps} ${sum}`;
}
function drainTexts(list) {
  let all = "";
  for (let first = list.shift(); first !== undefined; first = list.shift())
    all += first + (list[0] ?? "|") + list.length;
  return all;
}
function afterThree(list) {
  list.shift();
  list.shift();
  list.shift();
  return list.map(element => (Object.is(element, -0) ? "-0" : String(element))).join();
}

for (let length = 0; length <= 40; length++) {
  const fractions = new Array(length).fill(0.5).map((half, index) => half + index);
  const whole = Array.from({ length }, (_, index) => index * 3 - 7);
  const texts = Array.from({ length }, (_, index) => "t" + index);
  const mixed = Array.from({ length }, (_, index) => (index % 3 === 0 ? index + 0.25 : index % 3 === 1 ? index : NaN));
  console.log(length, drainNumbers(fractions), drainNumbers(whole), drainNumbers(mixed), drainTexts(texts).length);
}
for (const length of [3, 4, 8, 9, 10, 11, 16, 17, 18, 25]) {
  const odd = new Array(length).fill(1.5);
  odd[1] = NaN;
  odd[length - 1] = -0;
  odd[length >> 1] = -Infinity;
  const holed = new Array(length).fill(2.5);
  delete holed[length - 2];
  console.log(length, afterThree(odd), "/", afterThree(holed), "/", afterThree(new Array(length)));
}

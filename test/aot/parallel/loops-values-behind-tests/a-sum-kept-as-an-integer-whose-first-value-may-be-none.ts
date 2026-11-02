// A sum that a loop keeps as an int32, whose first value may be any whole number: the loop runs from an int32 and from what is none.
function sumFrom(first: number, list: number[]) {
  let sum = first;
  for (let i = 0; i < list.length; i++) sum = (sum + list[i]!) | 0;
  return sum;
}
function stepsFrom(first: number, limit: number) {
  let sum = first;
  let n = 0;
  while (n < limit) {
    sum = (sum + 1) | 0;
    n = n + 1;
  }
  return sum;
}
function stepsBehindWork(first: number, limit: number) {
  let sum = first;
  for (let n = 0; n < limit; n++) {
    if (n === 3) sum = (sum * 2) | 0;
    else sum = (sum + n) | 0;
  }
  return sum;
}
function nested(first: number, groups: number[][]) {
  let sum = first;
  for (const group of groups) for (const item of group) sum = (sum + item) | 0;
  return sum;
}
const list = Array.from({ length: 8 }, (_, n) => n * 3);
const groups = [list, [], list];
const firsts = [0, 7, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 9007199254740991, -9007199254740991, 1e21, -0];
let answers = "";
for (let turn = 0; turn < 3000; turn++) {
  answers = "";
  for (const first of firsts) {
    answers += sumFrom(first, list) + " " + stepsFrom(first, 5) + " " + stepsBehindWork(first, 6) + " " + nested(first, groups) + " ";
    answers += Object.is(stepsFrom(first, 0), first) + " " + Object.is(sumFrom(first, []), first) + " " + Object.is(nested(first, []), first) + "\n";
  }
}
console.log(answers);

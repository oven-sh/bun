// The sum of the integer and the element is named twice by each of the lines that double it.
function doubled(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    let twice = sum + list[i];
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    twice = twice + twice;
    sum = twice | 0;
  }
  return sum;
}

function halfTakenBack(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    let rest = sum + list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    rest = rest + rest - list[i];
    sum = rest | 0;
  }
  return sum;
}

const lists = [
  [1.5, 2, 3],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0.5],
  [2147483647, 2147483647, -2147483648, 0.25],
  [4294967296, 1e15, 3, -1e15, 0.75],
  [0.1, 0.2, 0.3, 1e300, -0],
  [7, NaN, 7, Infinity, 7, 0.5],
];
for (const list of lists) console.log(doubled(list), halfTakenBack(list));

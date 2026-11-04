// A loop adds whole numbers up, and another variable takes the sum as it stands in some of the turns only.
function takesItWhereLarger(list, start) {
  let largest = start, taken = start, sum = 0.5;
  for (let i = 0; i < list.length; i++) {
    sum += i & 3;
    if (list[i] > largest) {
      largest = list[i];
      taken = sum;
    }
  }
  return largest + " " + taken + " " + sum;
}

function takesItWhereNotLarger(list, start) {
  let largest = start, taken = start, sum = 0.5;
  for (let i = 0; i < list.length; i++) {
    sum -= i & 3;
    if (list[i] > largest) largest = list[i];
    else taken = sum;
  }
  return largest + " " + taken + " " + sum;
}

function takesItInEveryTurn(list) {
  let taken = -1, sum = 0.5;
  for (let i = 0; i < list.length; i++) {
    sum += list[i] & 1;
    taken = sum;
  }
  return taken + " " + sum;
}

function takesWhatItWasATurnAgo(list) {
  let before = -1, sum = 0.5;
  for (let i = 0; i < list.length; i++) {
    before = sum;
    sum += list[i] & 1;
  }
  return before + " " + sum;
}

function countsBesideAForOf(list, start) {
  let largest = start, place = start, count = -1;
  for (const element of list) {
    count++;
    if (element > largest) {
      largest = element;
      place = count;
    }
  }
  return largest + " " + place + " " + count;
}

function countsByTwoBesideAForOf(list, start) {
  let largest = start, place = start, count = -1;
  for (const element of list) {
    count += 2;
    if (element > largest) {
      largest = element;
      place = count;
    }
  }
  return largest + " " + place + " " + count;
}

function addsWhatIsHandedIn(list, step, start) {
  let largest = start, taken = start, sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += step;
    if (list[i] > largest) {
      largest = list[i];
      taken = sum;
    }
  }
  return largest + " " + taken + " " + sum;
}

function twoVariablesTakeIt(list, step) {
  let first = -1, second = -1, sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += step;
    if (list[i] & 1) first = sum;
    if (list[i] & 2) second = sum;
  }
  return first + " " + second + " " + sum;
}

function oneSumTakesTheOther(list, step) {
  let one = 0, other = 0.5;
  for (let i = 0; i < list.length; i++) {
    one += step;
    if (list[i] & 1) other = one;
    else other += 1;
  }
  return one + " " + other;
}

const lists = [
  [],
  [4],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 5, 9, 3, 9, 2, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
  [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
];
for (const plain of lists) {
  for (const list of [plain, Int16Array.from(plain), Float64Array.from(plain), Uint8Array.from(plain)]) {
    console.log(
      list.length,
      "|", takesItWhereLarger(list, 0),
      "|", takesItWhereNotLarger(list, 0),
      "|", takesItInEveryTurn(list),
      "|", takesWhatItWasATurnAgo(list),
      "|", countsBesideAForOf(list, 0),
      "|", countsByTwoBesideAForOf(list, 0),
      "|", addsWhatIsHandedIn(list, 3, 0),
      "|", addsWhatIsHandedIn(list, 0.5, 0),
      "|", twoVariablesTakeIt(list, 2),
      "|", oneSumTakesTheOther(list, 5),
    );
  }
}

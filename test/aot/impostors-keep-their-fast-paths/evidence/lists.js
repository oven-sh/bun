import { numbersUpTo, parsed, put, take } from "./out-of-sight.js";

function sumByIndex(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += list[i];
  return total;
}

function sumUpToLength(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumWithForOf(list) {
  let total = 0;
  for (const value of list) total += value;
  return total;
}

function storeByIndex(list) {
  for (let i = 0; i < 100; i++) list[i] = i;
  return list[99];
}

function pushAndPop(list) {
  for (let i = 0; i < 100; i++) list.push(i);
  let total = 0;
  for (let i = 0; i < 100; i++) total += list.pop();
  return total;
}

function pushWhatIsAlsoRead(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) {
    list.push(i);
    total += list[i];
  }
  list.length = 0;
  return total;
}

function sumOfGivenOrEmpty(given) {
  const list = given || [];
  let total = 0;
  for (let i = 0; i < 100; i++) total += list[i];
  return total;
}

function sumOfSecondName(given) {
  const list = given;
  let total = 0;
  for (let i = 0; i < 100; i++) total += list[i];
  return total;
}

function firstAndSecond(pairs) {
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const [first, second] = pairs[i];
    total += first - second;
  }
  return total;
}

function largestOfSpread(list) {
  return Math.max(...list);
}

function copyBySpread(list) {
  return [...list].length;
}

const squares = [];
for (let i = 0; i < 128; i++) squares.push(i * i);

function lookUpSquares(keys) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += lookUpSquare(keys[i]);
  return total;
}

function lookUpSquare(key) {
  return squares[key];
}

function countWithWholeNumber(list) {
  var at = 0;
  var total = 0;
  while (at < 100) {
    total += list[at];
    at = at + 1;
  }
  return total;
}

function collect(count) {
  let found = [];
  for (let i = 0; i < count; i++) found.push(i);
  return found;
}

function sumOfCollected(count) {
  const found = collect(count);
  let total = 0;
  for (let i = 0; i < found.length; i++) total += found[i];
  return total;
}

function sumRows(table) {
  let total = 0;
  for (let i = 0; i < table.tableRows.length; i++) total += table.tableRows[i];
  return total;
}

function tableOutOfSight() {
  put("table", { tableRows: numbersUpTo(100), tableName: "t" });
  return take("table");
}

export const cases = {
  "elements are read under a number": { prepare: () => numbersUpTo(100), turn: sumByIndex },
  "elements are read up to the length": { prepare: () => numbersUpTo(100), turn: sumUpToLength },
  "a list is walked with for-of": { prepare: () => numbersUpTo(100), turn: sumWithForOf },
  "elements are stored under a number": { prepare: () => numbersUpTo(100), turn: storeByIndex },
  "push and pop are called": { prepare: () => parsed("[]"), turn: pushAndPop },
  "push is called on what is also read under a number": { prepare: () => parsed("[]"), turn: pushWhatIsAlsoRead },
  "a value passes through || before it is read under a number": {
    prepare: () => numbersUpTo(100),
    turn: sumOfGivenOrEmpty,
  },
  "a value gets a second name before it is read under a number": {
    prepare: () => numbersUpTo(100),
    turn: sumOfSecondName,
  },
  "a pair is destructured as a list": {
    prepare: () => parsed(JSON.stringify(Array.from({ length: 100 }, (_, i) => [i * 2, i]))),
    turn: firstAndSecond,
  },
  "a list is spread into arguments": { prepare: () => numbersUpTo(100), turn: largestOfSpread },
  "a list is spread into a list": { prepare: () => numbersUpTo(100), turn: copyBySpread },
  "a value is the key of a list": { prepare: () => numbersUpTo(100), turn: lookUpSquares },
  "a variable that starts at zero and grows by one is a key": {
    prepare: () => numbersUpTo(100),
    turn: countWithWholeNumber,
  },
  "a function returns the list it made": { prepare: () => parsed("100"), turn: sumOfCollected },
  "a member of an object is used as a list": { prepare: tableOutOfSight, turn: sumRows },
};

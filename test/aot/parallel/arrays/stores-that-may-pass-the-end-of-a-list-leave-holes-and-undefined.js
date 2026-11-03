// Each loop looks like a sort or a shift by hand, and each one leaves the length of its list in some turn: it stores beyond the end, reads beyond it and stores what it found,
// counts with a number that is no position, or runs on a length that was read before the list got shorter. What is printed shows every hole and every undefined.
function shown(list) {
  let text = list.length + ":";
  for (let k = 0; k < list.length; k++) text += " " + (k in list ? String(list[k]) : "hole");
  return text;
}

function storesOneBeyondTheEnd(seed) {
  const list = [4, 3, 2, seed & 7];
  for (let k = 0; k < list.length && k < 6; k++) list[k + 1] = list[k] + 1;
  return list;
}

function storesTwoBeyondTheEnd(seed) {
  const list = [4, 3, 2, seed & 7];
  for (let k = list.length - 1; k < 8; k += 3) list[k + 2] = k;
  return list;
}

function readsOneBeyondTheEnd(seed) {
  const list = [4, 3, 2, seed & 7];
  for (let k = 0; k < list.length; k++) list[k] = list[k + 1];
  return list;
}

function sortsUpToTheLength(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let end = list.length; end > 0; end--)
    for (let k = 0; k < end; k++)
      if (!(list[k] <= list[k + 1])) {
        const held = list[k];
        list[k] = list[k + 1];
        list[k + 1] = held;
      }
  return list;
}

function endsBetweenTwoPositions(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let end = list.length - 0.5; end > 0; end--) for (let k = 0; k < end; k++) list[k + 1] = list[k];
  return list;
}

function endGrows(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let end = list.length - 1, turns = 0; turns < 3; end += 2, turns++) for (let k = 0; k < end; k++) list[k + 1] = k;
  return list;
}

function startsBelowZero(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let k = list.length - 1; k >= -2; k--) list[k] = k;
  return shown(list) + " | " + list[-1] + " " + list[-2];
}

function countsByHalves(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let k = 0; k < list.length - 1; k += 0.5) list[k] = k;
  return shown(list) + " | " + list[0.5] + " " + list[2.5];
}

function countsWithWhatIsNoNumber(seed) {
  const list = [9, 3, 7, seed & 15];
  let k = 0 / (seed & 0);
  list[k] = 1;
  list[-0] = 2;
  list[k + 1] = 3;
  return shown(list) + " | " + list.NaN;
}

function countsFarBeyondWhatIsExact(seed) {
  const list = [9, 3, 7, seed & 15];
  let stores = 0;
  for (let k = 2 ** 53 - 2; k < 2 ** 53 + 2 && stores < 5; k++, stores++) list[k + 1] = stores;
  return shown(list) + " | " + Object.keys(list).join(" ");
}

function shorterThanTheLengthThatWasRead(seed) {
  const list = [9, 3, 7, 5, 1, seed & 15];
  const count = list.length;
  list.pop();
  list.pop();
  list.pop();
  for (let k = count - 1; k > count - 2; k--) list[k] = k;
  return list;
}

function shorterInTheMiddleOfTheLoop(seed) {
  const list = [9, 3, 7, 5, 1, seed & 15];
  for (let end = list.length - 1; end > 0; end--) {
    if (end === 3) list.length = 1;
    for (let k = 0; k < end; k++) if (end === 2 && k === 1) list[k + 1] = list[k];
  }
  return list;
}

function readsAListWithAHole(seed) {
  const from = [1, , 3, seed & 15];
  const list = [0, 0, 0, 0];
  for (let k = 0; k < from.length && k < list.length; k++) list[k] = from[k];
  return list;
}

function readsByTheLengthOfAnotherList(seed) {
  const from = [1, 2];
  const list = [0, 0, 0, seed & 15];
  for (let k = 0; k < list.length; k++) list[k] = from[k];
  return list;
}

function storesByTheLengthOfAnotherList(seed) {
  const from = [1, 2, 3, 4, 5, 6, seed & 15];
  const list = [0, 0];
  for (let k = from.length - 1; k > 3; k--) list[k] = from[k];
  return list;
}

function holdsUndefinedFromTheStart(seed) {
  const list = [3, undefined, 1, seed & 15];
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const held = list[low];
    list[low] = list[high];
    list[high] = held;
  }
  return list;
}

function shortenedByAClosureInTheLoop(seed) {
  const list = [9, 3, 7, 5, 1, seed & 15];
  const drop = () => {
    list.pop();
    list.pop();
    list.pop();
  };
  for (let k = 0; k < list.length - 1; k++) {
    if (k === 3) drop();
    list[k + 1] = list[k];
  }
  return list;
}

function readsAListThatGotShorter(seed) {
  const from = [1, 2, 3, seed & 15];
  const count = from.length;
  from.pop();
  from.pop();
  const list = [0, 0, 0, 0];
  for (let k = 0; k < count && k < list.length; k++) list[k] = from[k];
  return list;
}

function lengthened(seed) {
  const list = [9, 3, seed & 15];
  list.length = 6;
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const held = list[low];
    list[low] = list[high];
    list[high] = held;
  }
  return list;
}

function hasAnElementDeleted(seed) {
  const list = [9, 3, 7, seed & 15];
  delete list[1];
  for (let k = 0; k < list.length - 1; k++) list[k] = list[k + 1];
  return list;
}

function storesAnElementOrNothing(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let k = 0; k < list.length; k++) {
    const held = (k + seed) & 1 ? list[k] : undefined;
    list[k] = held;
  }
  return list;
}

function storesAnElementFromInsideOrOutside(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let k = 0; k < list.length; k++) {
    let held = list[k];
    if ((k + seed) & 1) held = list[k + 2];
    list[k] = held;
  }
  return list;
}

function countsDownToOneBelowZero(seed) {
  const list = [9, 3, 7, seed & 15];
  for (let k = list.length - 1; k >= -1; k--) list[k + 1] = k;
  return list;
}

function sum(list) {
  let total = 0;
  for (let k = 0; k < list.length; k++) total += list[k];
  return total;
}

for (const made of [
  storesOneBeyondTheEnd, storesTwoBeyondTheEnd, readsOneBeyondTheEnd, sortsUpToTheLength, endsBetweenTwoPositions, endGrows, startsBelowZero, countsByHalves, countsWithWhatIsNoNumber,
  countsFarBeyondWhatIsExact, shorterThanTheLengthThatWasRead, shorterInTheMiddleOfTheLoop, readsAListWithAHole, readsByTheLengthOfAnotherList, storesByTheLengthOfAnotherList, holdsUndefinedFromTheStart,
  shortenedByAClosureInTheLoop, readsAListThatGotShorter, lengthened, hasAnElementDeleted, storesAnElementOrNothing, storesAnElementFromInsideOrOutside, countsDownToOneBelowZero,
])
  for (let seed = 0; seed < 40; seed += 13) {
    const answer = made(seed);
    console.log(made.name, seed, typeof answer === "string" ? answer : shown(answer) + " | " + sum(answer));
  }

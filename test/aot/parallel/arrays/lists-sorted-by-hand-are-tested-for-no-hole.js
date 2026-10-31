// COUNT: branches <= 3381
// Lists written as literals are sorted, turned round and shifted by hand. Every store stands at a position below a length read from the same list, and what it stores was read
// inside that length or is a number. So no list gets a hole or holds undefined, and a read compares its position with the length and tests nothing else.
function bubbleSorted(seed) {
  const list = [9, 3, 7, 1, 8, 2, 6, 4, 5, seed & 15];
  for (let end = list.length - 1; end > 0; end--)
    for (let k = 0; k < end; k++)
      if (list[k] > list[k + 1]) {
        const held = list[k];
        list[k] = list[k + 1];
        list[k + 1] = held;
      }
  return list;
}

function bubbleSortedFromTheEnd(seed) {
  const list = [seed & 31, 12, 30, 4, 19, 8, 27, 1];
  const count = list.length;
  for (let start = 0; start < count - 1; start++)
    for (let k = count - 1; k > start; k--)
      if (list[k - 1] > list[k]) {
        const held = list[k - 1];
        list[k - 1] = list[k];
        list[k] = held;
      }
  return list;
}

function insertionSorted(seed) {
  const list = [14, 2, seed & 15, 11, 5, 0, 9];
  for (let next = 1; next < list.length; next++) {
    const held = list[next];
    let k = next - 1;
    while (k >= 0 && list[k] > held) {
      list[k + 1] = list[k];
      k--;
    }
    list[k + 1] = held;
  }
  return list;
}

function selectionSorted(seed) {
  const list = [6, 13, 2, seed & 7, 10, 1, 15, 4, 8];
  const count = list.length;
  for (let first = 0; first < count - 1; first++) {
    let least = first;
    for (let k = first + 1; k < count; k++) if (list[k] < list[least]) least = k;
    const held = list[first];
    list[first] = list[least];
    list[least] = held;
  }
  return list;
}

function turnedRound(seed) {
  const list = [1, 2, 3, 4, 5, 6, seed & 63];
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const held = list[low];
    list[low] = list[high];
    list[high] = held;
  }
  return list;
}

function shiftedDown(seed) {
  const list = [seed & 3, 20, 30, 40, 50];
  for (let k = 0; k < list.length - 1; k++) list[k] = list[k + 1];
  return list;
}

function countedUp(seed) {
  const list = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < list.length; k++) list[k] = (seed + k) & 255;
  return list;
}

function namesSorted(seed) {
  const list = ["pear", "fig", "plum", "apple", seed & 1 ? "cherry" : "quince"];
  for (let end = list.length - 1; end > 0; end--)
    for (let k = 0; k < end; k++)
      if (list[k] > list[k + 1]) {
        const held = list[k];
        list[k] = list[k + 1];
        list[k + 1] = held;
      }
  return list;
}

function written(list) {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k ? " " : "") + list[k];
  return text;
}

function namesWritten(list) {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k ? ", " : "") + list[k];
  return text;
}

for (const sorted of [bubbleSorted, bubbleSortedFromTheEnd, insertionSorted, selectionSorted, turnedRound, shiftedDown, countedUp])
  for (let seed = 0; seed < 70; seed += 23) console.log(sorted.name, seed, written(sorted(seed)));
for (let seed = 0; seed < 2; seed++) console.log("namesSorted", seed, namesWritten(namesSorted(seed)));

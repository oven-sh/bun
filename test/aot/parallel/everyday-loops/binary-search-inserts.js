// A sorted list that is kept by binary search and splice
function insertAll(values) {
  const list = [];
  let looks = 0;
  for (const value of values) {
    let low = 0, high = list.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      looks++;
      if (list[middle] < value) low = middle + 1;
      else high = middle;
    }
    if (list[low] === value) list[low + 0.5] = value;
    else list.splice(low, 0, value);
  }
  return list.join() + " " + list.length + " " + looks + " " + Object.keys(list).length;
}
console.log(insertAll([5, 1, 4, 1, 3]));
console.log(insertAll([0.5, 0.25, 2, -1, 1e10]));
console.log(insertAll(["b", "a", "c", "a"]), insertAll([]));

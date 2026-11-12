// Counters of an object and of a list raised by elements
function count(list) {
  const counts = { odd: 0, big: 0 };
  const by = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      if (list[k] & 1) counts.odd++;
      by[k] += list[i];
    }
    if (list[i] > 2) counts.big += list[i];
  }
  return JSON.stringify(counts) + " " + by.join();
}
console.log(count([1, 2, 3, 4]));
console.log(count([2147483647, 1, -1, 0.5]));
console.log(count([3, 3, 3, 3]), count(["1", "2", "3", "4"]));

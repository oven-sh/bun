// A bubble sort of five numbers, with the number of swaps behind every pass
function passes(list) {
  const swaps = [];
  for (let i = 0; i < 4; i++) {
    let count = 0;
    for (let k = 0; k < 4 - i; k++) {
      if (list[k] > list[k + 1]) {
        [list[k], list[k + 1]] = [list[k + 1], list[k]];
        count++;
      }
      swaps.push(list[k]);
    }
    swaps.push(-count);
  }
  return list.join() + " ; " + swaps.join();
}
console.log(passes([5, 4, 3, 2, 1]));
console.log(passes([1, 2, 3, 4, 5]));
console.log(passes([2, 1, 2, 1, 2]));

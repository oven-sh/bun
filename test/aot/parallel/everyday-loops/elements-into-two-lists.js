// Elements pushed onto two lists, by the inner loop and behind it
function divide(list, border) {
  const low = [];
  const all = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      if (list[k] < border) low.push(list[k]);
      all.push(list[k] - i);
    }
    all.push(list[i]);
    low.push(all.length);
  }
  return low.join() + " ; " + all.join();
}
console.log(divide([1, 5, 9], 5));
console.log(divide([2, 20, 200], 100));
console.log(divide([4, 4, 4], 4));

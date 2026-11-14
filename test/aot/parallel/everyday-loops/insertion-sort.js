// An insertion sort that counts its moves, over numbers, texts and pairs
function sort(list, before) {
  let moves = 0;
  for (let i = 1; i < list.length; i++) {
    const value = list[i];
    let k = i - 1;
    while (k >= 0 && before(value, list[k])) {
      list[k + 1] = list[k];
      k--;
      moves++;
    }
    list[k + 1] = value;
  }
  return list.join(" ") + " moves " + moves;
}
console.log(sort([5, 2, 9, 1, 5, -3], (a, b) => a < b));
console.log(sort(["pear", "fig", "apple", "kiwi"], (a, b) => a.length < b.length));
console.log(sort([[2, "b"], [1, "a"], [2, "a"]], ([a, x], [b, y]) => a < b || (a === b && x < y)), sort([1.5, NaN, -0, 0.5], (a, b) => a < b));

// Subsets by the bits of a counter, sums pushed beside them
function subsets(list) {
  const out = [];
  const sums = [];
  for (let bits = 0; bits < 1 << list.length; bits++) {
    const chosen = [];
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      if ((bits >> i) & 1) {
        chosen.push(list[i]);
        sum += list[i];
      }
    }
    if (chosen.length !== 1) out.push(chosen.join("+"));
    sums.push(sum);
  }
  return out.join(" ") + " = " + sums.join();
}
console.log(subsets([1, 2, 4]));
console.log(subsets([0.5, -0.5, 2147483647]));
console.log(subsets([]), subsets(["a", 1]));

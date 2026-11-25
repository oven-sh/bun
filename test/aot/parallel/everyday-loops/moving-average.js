// Averages over three values, pushed beside the values
function averages(list) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      out.push(list[i + k]);
      sum += list[i + k];
    }
    out.push(sum / 3);
  }
  return out.join(" ") + " | " + out.length;
}
console.log(averages([3, 6, 9, 12, 15, 18, 21]));
console.log(averages([1, 1, 1, 1, 1, 1, 1]));
console.log(averages([0, 1, 0, 1, 0, 1, 0]));

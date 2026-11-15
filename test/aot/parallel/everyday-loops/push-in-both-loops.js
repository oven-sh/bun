// One list that an outer loop and its inner loop push into
function rows(height, width) {
  const out = [];
  for (let y = 0; y < height; y++) {
    out.push("row " + y);
    for (let x = 0; x < width; x++) {
      out.push(x * y);
    }
    out.push(out.length);
  }
  return out;
}
console.log(rows(3, 4).join());
console.log(rows(5, 2).join());
console.log(rows(1, 0).join(), rows(0, 9).length);

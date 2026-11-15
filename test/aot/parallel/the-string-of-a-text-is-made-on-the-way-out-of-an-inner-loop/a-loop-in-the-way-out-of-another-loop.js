function tally(rows, stop) {
  let total = 0;
  for (let a = 0; a < rows.length; a++) {
    if (rows[a] === stop) {
      for (let b = 0; b < 3; b++) {
        let line = "";
        inner: for (let t = 0; t < 4; t++) {
          line += "x";
          for (let q = 0; q < 2; q++) { if (t === 2 && q === b) break inner; total += q; }
        }
        total += line.length * 10;
      }
      break;
    }
    total += 1;
  }
  return total;
}
let shown = "";
for (let round = 0; round < 50; round++) shown = [tally([5, 6, 7, 8], 7), tally([5, 6], 7)].join(" ");
console.log(shown);

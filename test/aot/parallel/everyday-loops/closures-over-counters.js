// Closures that capture a counter of the outer loop and one of the inner
function make(rows) {
  const functions = [];
  let total = 0;
  for (let y = 0; y < rows; y++) {
    let hits = 0;
    for (let x = 0; x <= y; x++) {
      functions.push(step => {
        hits += step;
        total += hits;
        return y + ":" + x + ":" + hits;
      });
    }
  }
  const out = [];
  for (let round = 1; round <= 2; round++) for (const call of functions) out.push(call(round));
  return out.join(" ") + " = " + total;
}
console.log(make(2));
console.log(make(3));
console.log(make(0), make(1));

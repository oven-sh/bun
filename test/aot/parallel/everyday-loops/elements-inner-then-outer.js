// Elements of a list pushed by the inner loop, then one by the outer loop
function repeat(at) {
  const values = [10, 20, 30];
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(values[at]);
    }
    out.push(values[i]);
  }
  return out.join() + " " + out.length;
}
console.log(repeat(0));
console.log(repeat(2));
console.log(repeat(1));

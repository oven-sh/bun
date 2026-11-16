// Under: --aot-harden=proof-checks: an element whose hole is read as NaN was tested for a number without a fraction, and the build stopped
function add(row, b, factor, width) {
  for (let y = 0; y < 3; y++) {
    for (let i = 0; i < width; i++) row[i] += factor * b[i];
  }
  return row;
}
console.log(add([1, 2, 3, 4], [NaN, -0, 1], undefined, 3).join());
console.log(add([1, 2], [1, 2], 0.5, 2).join());

function subtract(row, b, factor, width) {
  for (let i = 0; i < width; i++) row[i] -= b[i] * factor;
  return row;
}
const withHole = [4, 1, 2];
delete withHole[1];
console.log(subtract([1, 2, 3], withHole, undefined, 3).join());
console.log(subtract([1, 2, 3], withHole, 1.5, 3).join());
console.log(subtract([1, 2, 3, 4], [1, , NaN, -0], 2.5, 4).join());

function divide(row, b, factor, width) {
  let total = 0;
  for (let y = 0; y < 2; y++) {
    for (let i = 0; i < width; i++) {
      total += row[i] / factor;
      total += b[i] * factor;
    }
  }
  return total;
}
console.log(divide([1, 2], [3, 4], undefined, 2), divide([1, 2], [3, 4], 0.25, 2), divide([1, , 2], [NaN, 4], 0.25, 2));

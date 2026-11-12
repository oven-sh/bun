function one(d, a, b) {
  let sum = 0,
    turns = 0;
  try {
    for (let i = 0; i < d.length; i++) {
      turns++;
      sum = sum + d[i][a] * d[i][b];
    }
  } catch (e) {
    return e.name + " in turn " + turns + " at " + sum;
  }
  return sum;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) said.push(one(d, a, b));
  return said.join(" . ");
}
function listLike() {
  return arguments;
}
class Row extends Array {}
const heir = Row.from([2, 3, 4]);
const frozen = Object.freeze([1, 2, 3]);
const sparse = [1, , 3];
console.log(run([[1, 2, 3], new Float64Array([1.5, 2.5, 3.5]), { 0: 2, 1: 3, 2: 4 }, "123", listLike(4, 5, 6), new Uint8Array([7, 8, 9]), heir, frozen, sparse]));
console.log(run([[1, 2, 3], 7, true, Symbol.iterator]));
console.log(run([[1, 2, 3], null, [4, 5, 6]]));
console.log(run([[1, 2, 3], undefined]));

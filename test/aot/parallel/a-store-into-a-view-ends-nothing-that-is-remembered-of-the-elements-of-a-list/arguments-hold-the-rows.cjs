// The holder is an arguments object.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function rows() {
  let sum = 0;
  for (let k = 0; k < arguments.length; k++) { const held = arguments[k][1]; arguments[k][1] = held * 2; sum += arguments[k][1] + arguments[k][0]; }
  return sum;
}
const said = [];
for (let round = 0; round < 5; round++) said.push(rows(...data.map(row => Float64Array.from(row))));
console.log(said.join(" "));

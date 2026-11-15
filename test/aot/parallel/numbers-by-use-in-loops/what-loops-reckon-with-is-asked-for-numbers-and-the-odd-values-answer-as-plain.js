// Values of which nothing is known meet `*`, `-`, `/`, `%`, `**`, bit operators and a `+` beside a product, in loops. Each is asked once whether it is a number.
// Every kind of value that is none goes through the same loops: texts, null, undefined, booleans, objects with valueOf, big integers, symbols, -0, NaN, the infinities.
const rows = JSON.parse('[[1.5,2],[3,4.25],[-0.5,8],[1e308,10],[0,-1],[2147483647,2],[-2147483648,-1],[5e-324,0.5]]');
const odd = [["3", 2], [null, 5], [undefined, 1], [true, 7], [{ valueOf() { return 6; } }, 2], [[4], 2], [-0, 3], [NaN, 1], [Infinity, 0], [-Infinity, -1], ["x", 1], [2n, 3n], [2n, 1], [Symbol.for("s"), 1], [{ toString() { return "9"; } }, "2"]];
function reckon(list) {
  const said = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i][0], b = list[i][1];
    let line;
    try {
      line = [a * b, a - b, a / b, a % b, a ** b, a & b, a | b, a ^ b, a << b, a >> b, a * b + b, b + a * b, -a, a * a - b * b].map(v => Object.is(v, -0) ? "-0" : String(v)).join();
    } catch (error) {
      line = error.constructor.name;
    }
    said.push(line);
  }
  return said;
}
function sums(list) {
  let product = 0, mixed = 0, text = "";
  for (let i = 0; i < list.length; i++) {
    const a = list[i][0], b = list[i][1];
    try { product += a * b; mixed = mixed + (a * 2 + b); text = text + (a * 1 + "|"); } catch (error) { text += error.constructor.name; }
  }
  return [String(product), String(mixed), text].join(" ; ");
}
for (let round = 0; round < 3; round++) {
  console.log(reckon(rows).join("\n"));
  console.log(sums(rows));
}
console.log(reckon(odd).join("\n"));
console.log(sums(odd));
console.log(reckon(rows.concat(odd)).length, sums(rows.concat(odd.slice(0, 11))));

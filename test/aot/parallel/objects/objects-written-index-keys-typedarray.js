// Object literals and instances that are written with index keys get a typed array as their prototype, and for-in walks them. Plain Bun prints another output.
function walk(object) {
  let names = "";
  for (const name in object) names += name + ",";
  return names;
}
function below(own, above) {
  Object.setPrototypeOf(own, above);
  return own;
}
class Point {
  constructor() {
    this[0] = "zero";
    this.a = 1;
  }
}
console.log("0", walk(below({ 0: "zero" }, new Uint8Array(3))));
console.log("0 and 1", walk(below({ 0: "zero", 1: "one" }, new Uint8Array(3))));
console.log("0 and a name", walk(below({ 0: "zero", a: 1 }, new Uint8Array(3))));
console.log("a name and 0", walk(below({ a: 1, 0: "zero" }, new Uint8Array(3))));
console.log("1 alone", walk(below({ 1: "one" }, new Uint8Array(3))));
console.log("more than the typed array has", walk(below({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 }, new Uint8Array(3))));
console.log("an instance", walk(below(new Point(), new Uint8Array(3))));
console.log("fractions above", walk(below({ 0: "zero" }, new Float64Array(2))));
console.log("big integers above", walk(below({ 0: "zero" }, new BigInt64Array(2))));
console.log("two above", walk(below({ 0: "zero" }, below({ b: 1 }, new Uint8Array(2)))));
const walkedAgain = below({ 0: "zero", a: 1 }, new Uint8Array(3));
console.log("three walks", walk(walkedAgain), walk(walkedAgain), walk(walkedAgain));
/* Output:
0 0,1,2,
0 and 1 0,1,2,
0 and a name 0,a,1,2,
a name and 0 0,a,1,2,
1 alone 1,0,2,
more than the typed array has 0,1,2,3,4,
an instance 0,a,1,2,
fractions above 0,1,
big integers above 0,1,
two above 0,b,1,
three walks 0,a,1,2, 0,a,1,2, 0,a,1,2,
*/

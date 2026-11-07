// Each run of a file that threw has an object of its own for a place in the text, and within one run the place has one object, however often it is asked for.
const runs = [];
globalThis.report = (make) => runs.push(make);
for (let attempt = 0; attempt < 3; attempt++) {
  try { require("./thrower.cjs"); } catch (error) { console.log(error.message); }
}
const [first, second, third] = runs;
console.log(runs.length, second() === second(), third() === third(), second() === third());
let same = 0;
for (let turn = 0; turn < 1000; turn++) same += third() === third() ? 1 : 0;
console.log(same, Object.isFrozen(third()), third().raw[0]);
/* Output:
run 1
run 2
3 true true false
1000 true x
*/

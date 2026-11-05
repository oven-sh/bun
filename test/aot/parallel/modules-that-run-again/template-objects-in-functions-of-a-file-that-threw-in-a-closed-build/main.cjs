// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
// The closed twin of ../template-objects-in-functions-of-a-file-that-threw. There the function lies on globalThis, and a call of a global that nobody knows opens the build as eval does. Here it lies in a leaf file and is called out of a list: THE BUILD MUST BE CLOSED, which the line above holds.
// Each run of a file that threw has an object of its own for a place in the text, and within one run the place has one object, however often it is asked for.
const STAGE = require("./stage.cjs");
const runs = [];
STAGE.report = (make) => runs.push(make);
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

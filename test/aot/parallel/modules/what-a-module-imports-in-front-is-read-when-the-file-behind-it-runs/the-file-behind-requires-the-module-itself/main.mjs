// plain.cjs says nothing of its kind and nobody requires it. real.cjs, CommonJS, runs where the loader comes to it and requires main.mjs itself. The requests of main.mjs go out together, in the order in which they are written:
// the loader has read plain.cjs as an ES module by then, and that the require leads back to main.mjs changes nothing: main.mjs had begun. `bun <file>` prints this in 60 of 60 runs; where its threads race (like programs on a busier machine: 1, 6 and 4 of 24) plain.cjs runs sloppy.
import "./plain.cjs";
import "./real.cjs";
console.log("main");
/* Output:
real begins
plain strict
main
real ends
*/

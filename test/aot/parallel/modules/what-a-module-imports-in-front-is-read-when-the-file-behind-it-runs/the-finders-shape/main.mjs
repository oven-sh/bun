// plain.cjs says nothing of its kind. real.cjs, CommonJS, runs where the loader comes to it and requires plain.cjs at its top. The requests of main.mjs go out together, in the order in which they are written:
// the loader has read plain.cjs as an ES module by then. `bun <file>` prints this in 58 of 60 runs; in the others its threads race, the require reads the file first, and it runs twice, sloppy.
import "./plain.cjs";
import "./real.cjs";
console.log("main");
/* Output:
real begins
plain strict
real ends object
main
*/

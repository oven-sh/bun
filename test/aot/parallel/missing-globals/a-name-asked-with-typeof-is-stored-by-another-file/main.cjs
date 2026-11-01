// The name is asked about in this file and stored under, as a bare name of sloppy code, in the file that it requires.
console.log(typeof late);
require("./c.cjs");
console.log(typeof late, typeof late === "function" ? late() : "-");

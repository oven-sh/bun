// A member of a module of the library that is called through what an import helper makes is read on the module and called as the function that it is: a turn of the loop looks no name up and enters the run time for nothing.
// COUNT: arrivals <= 400
// COUNT: operations <= 1500
console.log(require("./enumerable-names.cjs").run(3000), require("./own-names.cjs").run(3000), require("./esbuild.cjs").run(3000));

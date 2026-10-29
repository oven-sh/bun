// The promise of import() looks for `then` on the namespace object of node:fs, and the program reads one member of it by name.
// Neither finds what the getters of other members have answered: the stream classes are not called, and the other functions of node:fs are not compiled.
// STATISTIC: ImageFunctionsEmitted <= 1100
const fs = await import("node:fs");
console.log(fs.readFileSync("/dev/null").length, typeof fs.then);

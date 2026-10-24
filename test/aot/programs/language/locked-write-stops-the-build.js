// A store that replaces a member of an always locked built-in stops the build when every run reaches it: it stands in the body of one of the program's own modules, under no condition and outside any `try`, so the program would end there with a TypeError. language/locked-write-that-may-not-run has the stores that build.
Array.prototype.includes = function (value) { return this.indexOf(value) !== -1; };
console.log([1, 2, 3].includes(2));
export {};

// The members of Math are fixed in a compiled program. A store to one of them that every run reaches stops the build, like a store to a member of a locked prototype: language/locked-member-write-stops-the-build. language/math-is-locked has what can be written.
Math.floor = function (x) { return x - (x % 1); };
console.log(Math.floor(1.5));
export {};

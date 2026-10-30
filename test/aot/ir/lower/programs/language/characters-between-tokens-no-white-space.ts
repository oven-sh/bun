// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1127 2
// DIAGNOSTIC: TS1134 2

// U+0085 and U+200B stand between tokens here. They are no white space of the language, so `bun run` reports them, and so does a build.
var nextLine =1;
var zeroWidthSpace =​2;
console.log(nextLine, zeroWidthSpace);

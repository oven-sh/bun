// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: FunctionsLowered <= 1000
// STATISTIC: SourceFilesRuntime <= 150
// STATISTIC: SourceFilesTypesOnly <= 460

// A program holds of Bun's own library what every program holds (`RuntimeUses::of_every_program`) and what it reaches by constant names and by bindings.
// The whole library is over 4,000 functions.
// The two counts of files stood at 70 and 420 before every program held that much, and are to come back there: nobody has found what brings the rest.

// FILE: main.js
console.log("a line");

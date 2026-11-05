// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: FunctionsLowered <= 1000
// STATISTIC: SourceFilesRuntime <= 70
// STATISTIC: SourceFilesTypesOnly <= 420

// A program holds of Bun's own library what it reaches by constant names and by bindings. The whole library is over 4,000 functions.

// FILE: main.js
console.log("a line");

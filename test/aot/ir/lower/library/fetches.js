// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: FunctionsLowered <= 1000

// FILE: main.js
const response = await fetch(process.argv[2]).catch(error => error);
console.log(typeof response);

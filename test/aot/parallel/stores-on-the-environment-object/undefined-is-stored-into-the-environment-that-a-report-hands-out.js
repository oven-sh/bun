// The report holds the very object that process.env answers, and the program names it in no other way. It prints nothing that would bring the library in by another road.
// Env: BUN_OPTIONS=--pending-deprecation
process.report.getReport().environmentVariables.MADE_UP = undefined;
console.log("stored");

// RUN: lower
// OPTIONS: builtin-modules

// `require.main === module` keeps its parentheses inside a larger expression.
console.log("main: " + (require.main === module) + ".");
console.log("main: " + (module === require.main) + ".");
console.log("main: " + (require.main == module) + ".");
console.log("not main: " + (require.main !== module) + ".");
console.log(1 + (require.main === module), typeof (require.main === module), !(require.main === module));
console.log((require.main === module).toString(), (require.main !== module).toString());
console.log((require.main === module) === true, (require.main === module) + "" === "true");
console.log((require.main === module) ? "yes" : "no", (require.main === module) && "and", (require.main !== module) || "or");
if (require.main === module) console.log("the statement as it is usually written");

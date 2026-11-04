import "./a.mjs";
console.log("c starts");
if (process.argv.length < 99) throw new Error("c fails");
console.log("c ends");

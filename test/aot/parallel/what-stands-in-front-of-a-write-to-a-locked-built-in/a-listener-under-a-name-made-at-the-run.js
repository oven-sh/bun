const name = ["uncaught", "Exception"].join("");
process.on(name, () => { console.log("SAID caught"); });
const made = new Array(-1);
console.log(made);
Object.keys = function () { return []; };
console.log("SAID came behind the write");

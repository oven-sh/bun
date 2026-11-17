process.on("uncaughtException", () => { console.log("SAID caught"); });
const made = Symbol.iterator + "";
console.log(made);
Object.keys = function () { return []; };
console.log("SAID came behind the write");

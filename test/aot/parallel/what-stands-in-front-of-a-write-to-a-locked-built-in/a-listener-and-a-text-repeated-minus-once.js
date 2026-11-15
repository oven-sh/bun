process.on("uncaughtException", () => { console.log("SAID caught"); });
const made = "a".repeat(-1);
console.log(made);
Object.keys = function () { return []; };
console.log("SAID came behind the write");

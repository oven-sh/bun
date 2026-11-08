function read() { try { return late.rate; } catch (error) { return error.name; } }
process.on("uncaughtException", () => { console.log("caught", read()); });
if (process.argv.length < 99) throw new Error("out of the body");
const late = { rate: 0.2 };
console.log(read());

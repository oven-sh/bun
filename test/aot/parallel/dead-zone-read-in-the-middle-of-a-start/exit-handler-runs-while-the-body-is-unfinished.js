function read() { try { return late.rate; } catch (error) { return error.name; } }
process.on("exit", () => { console.log("at exit", read()); });
if (process.argv.length < 99) process.exit(0);
const late = { rate: 0.2 };
console.log(read());

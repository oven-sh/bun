function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
process.on("unhandledRejection", () => { seen = read(); });
Promise.reject(new Error("no"));
await new Promise(resolve => setTimeout(resolve, 30));
const late = { rate: 0.2 };
console.log(seen, read());

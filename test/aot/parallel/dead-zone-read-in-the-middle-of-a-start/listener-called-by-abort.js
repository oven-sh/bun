function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const controller = new AbortController();
controller.signal.addEventListener("abort", () => { seen = read(); });
controller.abort();
const late = { rate: 0.2 };
console.log(seen, read());

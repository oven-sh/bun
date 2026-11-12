export function read() { try { return late.rate; } catch (error) { return error.name; } }
await import("./below.mjs");
const late = { rate: 0.2 };
console.log("main", read());

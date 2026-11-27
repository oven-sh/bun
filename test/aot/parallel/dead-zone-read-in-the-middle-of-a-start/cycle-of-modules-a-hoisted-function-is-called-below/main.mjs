import "./below.mjs";
export function read() { try { return late.rate; } catch (error) { return error.name; } }
const late = { rate: 0.2 };
console.log("main", read());

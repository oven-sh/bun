function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const target = new EventTarget();
target.addEventListener("go", () => { seen = read(); });
target.dispatchEvent(new Event("go"));
const late = { rate: 0.2 };
console.log(seen, read());

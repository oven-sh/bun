function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const { EventEmitter } = require("node:events");
const emitter = new EventEmitter();
emitter.on("go", () => { seen = read(); });
emitter.emit("go");
const late = { rate: 0.2 };
console.log(seen, read());

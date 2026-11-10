const make = require("./factory.cjs");
let made = make({ size: 100000, hook: function (n) { return n + 1; } });
function again() { return typeof made; }
console.log(made.touch());
const ref = made.ref();
made = null;
for (let i = 0; i < 6; i++) { let filler = []; for (let j = 0; j < 20000; j++) filler.push({ j }); Bun.gc(true); }
console.log(ref.deref() === undefined ? "let go" : "kept", again());

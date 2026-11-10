const make = require("./factory.cjs");
function run() { const made = make({ size: 100000, hook: function (n) { return n + 1; } }); console.log(made.touch()); return made.ref(); }
function again() { return typeof make; }
const ref = run();
for (let i = 0; i < 6; i++) { let filler = []; for (let j = 0; j < 20000; j++) filler.push({ j }); Bun.gc(true); }
console.log(ref.deref() === undefined ? "let go" : "kept", again());

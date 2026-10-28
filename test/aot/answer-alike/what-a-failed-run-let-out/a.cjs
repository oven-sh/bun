// The body of a module throws after it has let an object and a closure out, and the module is required again. What the first run made is not what the second run makes.
let first; try { require("./fails-once.cjs"); } catch (error) { first = error.message; }
const second = require("./fails-once.cjs");
const [old, fresh] = globalThis.kept;
old.bump(); second.state.n = 5; fresh.state.list.push(1);
console.log(old.state === fresh.state, old.bump === fresh.bump, old.state.n, fresh.state.n, old.state.list.length, fresh.state.list.length);

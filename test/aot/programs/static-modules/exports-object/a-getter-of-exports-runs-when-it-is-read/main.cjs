// A getter that returns a member of another module is that member only once its variable is set, and only if reading it does nothing else.
function said(f) { try { return String(f()); } catch (error) { return error.constructor.name; } }
console.log(said(() => require("./early.cjs").log));
globalThis.order = [];
const lazy = require("./lazy.cjs");
order.push("required lazy");
console.log(lazy.value, order.join());
const conditional = require("./conditional.cjs");
console.log(Object.keys(conditional).join(), conditional.value);
const counted = require("./counted.cjs");
console.log(counted.value, counted.value, counted.reads());

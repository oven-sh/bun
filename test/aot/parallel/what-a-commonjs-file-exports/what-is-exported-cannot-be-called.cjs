const number = require("./lib-number.cjs");
function call() { return number(); }
function make() { return new number(); }
for (const f of [call, make]) { for (let i = 0; i < 3; i++) { try { f(); } catch (error) { console.log(error.constructor.name); } } }
console.log(number + 1);

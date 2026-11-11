if ("" + /a/ === "b") module.exports = 1;
const frozen = Object.freeze({ size: 1 });
let outcome = "silent";
try { frozen.size = 2; } catch (error) { outcome = error.name; }
function self() { return this === undefined; }
console.log(outcome, self());

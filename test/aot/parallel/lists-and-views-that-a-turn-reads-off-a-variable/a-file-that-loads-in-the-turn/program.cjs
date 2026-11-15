const said = [];
function total(rounds) { let s = 0; for (let r = 0; r < rounds; r++) { const late = require("./late.cjs"); s += late.sum(4) + late.first(); } return s; }
said.push(total(0), total(1), total(3));
const cycle = require("./first-of-a-cycle.cjs");
said.push(cycle.early, cycle.sum(4));
console.log(said.join(" "));

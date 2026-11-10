// Under: --aot-harden=proof-checks: the read of the source's name is carried in front of the loop; what the walk remembers of the cell is asked in the turn, behind the tests that say so
"use strict";
const source = { base: 2.5, get twice() { return this.base * 2.25; } };
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const spread = { ...source, base: i }; const assigned = Object.assign({ base: i }, source); s += spread.twice + assigned.twice + source.twice; } return s; }
console.log(drive(+(process.argv[2] ?? 20)));

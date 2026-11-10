// The twin: the same stores where no loop stands: no code in line.
// STATISTIC: StoresByNameThatAskTheirSitesInLine = 0
"use strict";
function once(crate, given) { crate.lid = given; crate.hinge = given + 1; return crate.lid + crate.hinge; }
const crate = JSON.parse('{"hinge":1,"lid":0}');
console.log(once(crate, 1), once(crate, 2), once(crate, 3), once(crate, 4), JSON.stringify(crate));

// What stands in front of a loop: a list read through a field in a loop null behind a break.
"use strict";
function go(turns, record, stop) { let sum = 0; for (let turn = 0; turn < turns; turn++) { if (turn >= stop) break; sum += record.items[turn]; } return sum; }
try { console.log("SAID", go(Number("3"), null, Number("0"))); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", go(Number("3"), { items: JSON.parse("[1,2,3]") }, Number("3"))); } catch (error) { console.log("SAID", error.name); }

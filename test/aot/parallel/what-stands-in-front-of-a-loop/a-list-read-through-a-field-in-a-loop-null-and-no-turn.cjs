// What stands in front of a loop: a list read through a field in a loop null and no turn.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum += record.items[turn]; return sum; }
try { console.log("SAID", go(Number("0"), null)); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", go(Number("3"), { items: JSON.parse("[1,2,3]") })); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", go(Number("1"), null)); } catch (error) { console.log("SAID", error.name); }

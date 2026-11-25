// What stands in front of a loop: a list read through a field in a loop null and a store into the list.
"use strict";
function go(turns, record) { for (let turn = 0; turn < turns; turn++) record.items[turn] = turn; return record ? record.items.join() : "none"; }
try { console.log("SAID", go(Number("0"), null)); } catch (error) { console.log("SAID", error.name); }
try { console.log("SAID", go(Number("2"), { items: JSON.parse("[1,2,3]") })); } catch (error) { console.log("SAID", error.name); }

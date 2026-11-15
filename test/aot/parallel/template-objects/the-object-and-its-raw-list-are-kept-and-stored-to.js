// A tag keeps its template object and the list of raw texts, and code stores to both: they are frozen, each site has one object for good, and the tag goes on reading the texts of the source.
"use strict";
const kept = [];
function tag(strings) { kept.push(strings, strings.raw); return strings[0] + "|" + strings.raw[0] + "|" + strings.length; }
function run() { return tag`\x41${0}`; }

function deed(list) {
  try { list[0] = "changed"; return "stored"; } catch (error) { return error.name; }
}
console.log(run());
console.log(deed(kept[0]), deed(kept[1]), run());
let said = "";
for (let i = 0; i < 200; i++) said = run();
console.log(said, String(kept[0] === kept[2]), String(kept[1] === kept[3]), String(kept[0] === kept[400]), String(Object.isFrozen(kept[0])), String(Object.isFrozen(kept[1])));
try { kept[0].length = 0; } catch (error) { console.log(error.name); }
try { Object.defineProperty(kept[0], "raw", { value: [] }); } catch (error) { console.log(error.name); }
console.log(run(), Object.getOwnPropertyNames(kept[0]).join(), String(Object.keys(kept[0]).length));

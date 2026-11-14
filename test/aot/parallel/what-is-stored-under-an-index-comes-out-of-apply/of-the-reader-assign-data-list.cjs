var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function target(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road(x) { var list = [JSON.parse(String(x))]; Object.assign(list, JSON.parse('{"0":"t"}')); return target.apply(null, list); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(target(turn) + " | " + road(turn)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID assign-data-list " + out.join(" ; "));

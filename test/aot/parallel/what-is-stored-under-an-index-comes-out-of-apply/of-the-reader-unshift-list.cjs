var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function target(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road(x) { var list = [JSON.parse(String(x))]; Array.prototype.unshift.call(list, "t"); return target.apply(null, list); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(target(turn) + " | " + road(turn)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID unshift-list " + out.join(" ; "));

var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road() { if (arguments[1]) { return Object.freeze(arguments).callee("frozen", false); } return shape(arguments[0]); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(road(turn, false) + " | " + road(turn, true)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID frozen " + out.join(" ; "));

var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road() { if (arguments[1]) { var r; Object.entries(Object.getOwnPropertyDescriptors(arguments)).forEach(function (e) { if (e[0] === names[0]) r = e[1].value("entries", false); }); return r; } return shape(arguments[0]); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(road(turn, false) + " | " + road(turn, true)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID entries-of-descriptors " + out.join(" ; "));

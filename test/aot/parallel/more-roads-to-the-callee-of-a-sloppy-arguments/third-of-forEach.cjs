var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road() { if (arguments[1]) { var r; Array.prototype.forEach.call(arguments, function (v, i, whole) { if (i === 0) r = whole.callee("third", false); }); return r; } return shape(arguments[0]); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(road(turn, false) + " | " + road(turn, true)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID third-of-forEach " + out.join(" ; "));

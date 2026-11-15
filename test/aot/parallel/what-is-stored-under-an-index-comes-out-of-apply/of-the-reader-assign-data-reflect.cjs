var names = JSON.parse('["callee", "length", "0"]');
function shape(x) { return typeof x === "string" ? "text " + x : x + 1; }
function target(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road(x) { Object.assign(arguments, JSON.parse('{"0":"t"}')); return Reflect.apply(target, null, arguments); }
var out = [];
for (var turn = 0; turn < 3; turn++) { try { out.push(target(turn) + " | " + road(turn)); } catch (e) { out.push("threw " + e.name); } }
console.log("SAID assign-data-reflect " + out.join(" ; "));

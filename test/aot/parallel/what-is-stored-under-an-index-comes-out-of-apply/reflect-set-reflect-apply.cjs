function target(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road(x) { var list = [x]; Reflect.set(list, "0", "t"); return Reflect.apply(target, null, list); }
var out = [];
for (var turn = 0; turn < 3; turn++) out.push(target(turn) + " | " + road(turn));
console.log(out.join(" ; "));

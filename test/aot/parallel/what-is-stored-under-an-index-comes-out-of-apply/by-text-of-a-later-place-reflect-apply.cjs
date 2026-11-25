function target(x) { return typeof x === "string" ? "text " + x : x + 1; }
function road(x) { var list = [x]; list["1"] = "t"; list.reverse(); return Reflect.apply(target, null, list); }
var out = [];
for (var turn = 0; turn < 3; turn++) out.push(target(turn) + " | " + road(turn));
console.log(out.join(" ; "));

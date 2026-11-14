function Target(x) { this.said = typeof x === "string" ? "text " + x : x + 1; }
function road(x) { var list = [x]; Object.assign(list, { 0: "t" }); return Reflect.construct(Target, list).said; }
var out = [];
for (var turn = 0; turn < 3; turn++) out.push(new Target(turn).said + " | " + road(turn));
console.log(out.join(" ; "));

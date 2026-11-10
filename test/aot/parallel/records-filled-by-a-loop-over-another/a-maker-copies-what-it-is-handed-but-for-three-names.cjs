// STATISTIC: FlowAppendedFields <= 1
const owns = Object.prototype.hasOwnProperty;
function make(kind, given) {
  var name, held = {}, mark = null;
  if (given != null) {
    if (given.mark !== undefined) mark = "" + given.mark;
    for (name in given) owns.call(given, name) && name !== "mark" && name !== "self" && name !== "origin" && (held[name] = given[name]);
  }
  return { kind: kind, mark: mark, held: held };
}
function tell(made) { var names = made.kind + ":" + made.mark + ":"; for (var name in made.held) names += name + "=" + made.held[name] + ","; return names; }
var out = [];
for (var round = 0; round < 40; round++) {
  var a = make("box", { pad: round, shade: 2 }), b = make("row", { mark: round, row: round }), c = make("text", { words: "w", origin: 1 }), d = make("none", null);
  out.push(a.held.pad + b.held.row + c.held.words.length + (d.mark === null ? 1 : 0), tell(a), tell(b), tell(c), tell(d), "mark" in b.held, c.held.origin, a.held.row);
}
console.log(out.slice(-8).join(" "), out.length);

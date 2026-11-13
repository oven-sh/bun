// Symbol keys, index keys and `__proto__` as keys of stores on function objects.
const log = [];
const mark = Symbol("mark");
const Kind = { tag: "kind" };
const Other = { tag: "other" };
function show(label, made) { log.push(label + " " + Reflect.ownKeys(made).map(String).join() + " | " + Object.getPrototypeOf(made).tag + " | " + made[mark] + " " + made[0] + " " + made[7] + " " + made["1.5"]); }
for (let round = 0; round < 4; round++) {
  for (const below of [false, true]) {
    function Made() {}
    if (below) Object.setPrototypeOf(Made, Kind);
    Made.zeta = 1; Made[mark] = round; Made[7] = "seven"; Made[0] = "zero"; Made["1.5"] = "text"; Made.alpha = 2;
    show("stores " + below, Made);
    if (below) { Made.__proto__ = Other; show("proto store", Made); }
    function Next() {}
    if (below) Object.setPrototypeOf(Next, Kind);
    Object.assign(Next, { zeta: 1, [mark]: round, 7: "seven", 0: "zero", ["__proto__"]: Other, alpha: 2 });
    show("assign " + below, Next);
    function Last() {}
    if (below) Object.setPrototypeOf(Last, Kind);
    Object.assign(Last, JSON.parse('{"__proto__":{"tag":"parsed"},"beta":1}'));
    show("parsed " + below, Last);
  }
}
console.log(log.join("\n"));

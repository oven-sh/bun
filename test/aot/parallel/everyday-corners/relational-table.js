// Relational table: compiled answers as plain.
const vs = [0, "", "10", "9", null, undefined, true, [2], NaN, "a"];
console.log(vs.map(a => vs.map(b => (a < b ? 1 : 0)).join("")).join(" "));

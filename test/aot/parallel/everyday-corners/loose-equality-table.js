// Loose equality table: compiled answers as plain.
const vs = [0, "", "0", null, undefined, false, [], [0], NaN, "a", {}];
console.log(vs.map(a => vs.map(b => (a == b ? 1 : 0)).join("")).join(" "));

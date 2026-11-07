// Swap by pattern of members: compiled answers as plain.
const o = { a: 1, b: "two" };
const l = [1, "two", null];
[o.a, o.b] = [o.b, o.a];
[l[0], l[2]] = [l[2], l[0]];
console.log(JSON.stringify(o), JSON.stringify(l));

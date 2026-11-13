const seen = new Set([1, 2]);
seen[0] = "x";
seen[1] = { v: 5 };
const list = Object.values(seen);
console.log(typeof list[0] + (list[0] === "x" ? list[0] + 1 : "") + list.length);

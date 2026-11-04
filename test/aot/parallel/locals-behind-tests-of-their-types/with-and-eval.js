function probe(value) { if (typeof value === "string") { eval("value = [1, 2, 3, 4]"); return value.length; } if (Array.isArray(value)) { eval("value = 'ab'"); return value.length; } return "no"; }
function scoped(value) { var scope = { value: "scoped!" }; with (scope) { if (typeof value === "string") return value.length; } return "no"; }
module.exports = { probe, scoped };
for (let round = 0; round < 3; round++) console.log(["abc", [1, 2, 3], 5, null].map(value => probe(value) + ":" + scoped(value)).join(" "));

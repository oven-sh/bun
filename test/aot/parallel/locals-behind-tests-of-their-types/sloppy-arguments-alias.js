function probe(value) { if (typeof value === "string") { arguments[0] = [1, 2]; return value.length; } if (Array.isArray(value)) { arguments[0] = "four"; return value.length; } return "no"; }
function viaCallee(value) { function write(list) { list[0] = { length: "written" }; } if (Array.isArray(value)) { write(arguments); return value.length; } return "no"; }
module.exports = { probe, viaCallee };
globalThis.probe = probe;
for (let round = 0; round < 3; round++) console.log(["abc", [1, 2, 3], 5, null].map(value => probe(value) + ":" + viaCallee(value)).join(" "), (function () { return this === undefined; })());

const seen = [];
class K { set s(value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); } }
const k = new K();
k.s = 7;
({ a: k.s } = { a: "text" }); [k.s] = [];
console.log(seen.join(" "));

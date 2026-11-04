const seen = [];
class A extends Array { constructor(length, more) { super(); seen.push("length:" + typeof length + (length === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); } }
new A("hand", "hand");
new A("h").map(v => v);
console.log(seen.join(" "));

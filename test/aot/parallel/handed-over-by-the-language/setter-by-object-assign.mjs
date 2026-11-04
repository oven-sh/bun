const seen = [];
class K { set s(value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); } }
new K().s = 7;
Object.assign(new K(), { s: "text" });
console.log(seen.join(" "));

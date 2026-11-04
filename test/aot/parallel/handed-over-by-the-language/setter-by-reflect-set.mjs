const seen = [];
class K { set s(value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); } }
new K().s = 7;
Reflect.set(new K(), "s", "text"); Reflect.set(new K(), "s");
console.log(seen.join(" "));

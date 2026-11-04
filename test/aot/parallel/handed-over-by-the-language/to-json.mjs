const seen = [];
class K { toJSON(key) { seen.push("key:" + typeof key + (key === undefined ? "!" : "")); return 1; } }
new K().toJSON(7);
JSON.stringify({ a: new K() }); JSON.stringify([new K()]); JSON.stringify(new K());
console.log(seen.join(" "));

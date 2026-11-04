const seen = [];
function revive(key, value) { seen.push("key:" + typeof key + (key === undefined ? "!" : "")); seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push(typeof this); return value; }
revive.call(1, 1, "hand");
JSON.parse("[1]", revive);
console.log(seen.join(" "));

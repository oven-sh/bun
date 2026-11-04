const seen = [];
function replace(key, value) { seen.push("key:" + typeof key + (key === undefined ? "!" : "")); seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push(typeof this); return value; }
replace.call(1, 1, "hand");
JSON.stringify([1], replace);
console.log(seen.join(" "));

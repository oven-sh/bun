const seen = [];
function cb(value, index, list, more) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push("index:" + typeof index + (index === undefined ? "!" : "")); seen.push("list:" + typeof list + (list === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return 0; }
cb("hand", "hand", "hand", "hand");
[true].findLastIndex(cb);
console.log(seen.join(" "));

const seen = [];
function cb(sum, value, index, list, more) { seen.push("sum:" + typeof sum + (sum === undefined ? "!" : "")); seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push("index:" + typeof index + (index === undefined ? "!" : "")); seen.push("list:" + typeof list + (list === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return sum; }
cb("h", "h", "h", "h", "h");
[true, false].reduce(cb); [true].reduce(cb, 0);
console.log(seen.join(" "));

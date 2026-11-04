const seen = [];
function f(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
f(7, 8);
f(...JSON.parse("[]")); f(...JSON.parse("[\"text\"]"));
console.log(seen.join(" "));

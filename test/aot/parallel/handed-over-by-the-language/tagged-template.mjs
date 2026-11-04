const seen = [];
function tag(strings, first, second) { seen.push("strings:" + typeof strings + (strings === undefined ? "!" : "")); seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
tag(1, 2, 3);
tag`a${"x"}b`; tag`plain`;
console.log(seen.join(" "));

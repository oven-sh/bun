const seen = [];
function tag(strings) { seen.push("n:" + arguments.length); }
tag(1);
tag`a${"x"}b${1}c`; tag`plain`;
console.log(seen.join(" "));

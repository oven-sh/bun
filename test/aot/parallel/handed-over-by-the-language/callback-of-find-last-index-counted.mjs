const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
[true].findLastIndex(cb);
console.log(seen.join(" "));

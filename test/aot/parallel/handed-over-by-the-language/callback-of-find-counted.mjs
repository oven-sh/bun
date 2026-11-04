const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
[true].find(cb);
console.log(seen.join(" "));

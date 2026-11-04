const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
[true].flatMap(cb);
console.log(seen.join(" "));

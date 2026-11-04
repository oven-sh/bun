const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
new Map([[true, "v"]]).forEach(cb);
console.log(seen.join(" "));

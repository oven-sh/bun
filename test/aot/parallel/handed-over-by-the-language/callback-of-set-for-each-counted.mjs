const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
new Set([true]).forEach(cb);
console.log(seen.join(" "));

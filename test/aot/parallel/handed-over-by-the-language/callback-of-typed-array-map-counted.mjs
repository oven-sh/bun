const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
new Uint8Array(1).map(cb);
console.log(seen.join(" "));

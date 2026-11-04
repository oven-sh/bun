const seen = [];
function cb(value) { seen.push("n:" + arguments.length); return 0; }
cb("hand");
Array.from([true], cb);
console.log(seen.join(" "));

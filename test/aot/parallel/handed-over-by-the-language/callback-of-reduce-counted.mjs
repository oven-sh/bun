const seen = [];
function cb(sum) { seen.push("n:" + arguments.length); return sum; }
cb("h");
[true, false].reduce(cb);
console.log(seen.join(" "));

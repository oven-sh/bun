const seen = [];
function job(value) { seen.push("n:" + arguments.length); }
job(7);
queueMicrotask(job);
await null;
console.log(seen.join(" "));

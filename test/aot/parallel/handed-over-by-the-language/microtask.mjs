const seen = [];
function job(value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); }
job(7);
queueMicrotask(job);
await null;
console.log(seen.join(" "));

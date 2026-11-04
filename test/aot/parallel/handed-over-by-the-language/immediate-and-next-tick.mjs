const seen = [];
function job(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
job(7, 8);
setImmediate(job, "text"); process.nextTick(job, true, "text"); process.nextTick(job);
setTimeout(() => console.log(seen.join(" ")), 20);

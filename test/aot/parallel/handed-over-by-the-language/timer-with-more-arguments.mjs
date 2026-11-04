const seen = [];
function job(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
job(7, 8);
setTimeout(job, 0, "text"); setTimeout(job, 0);
setTimeout(() => console.log(seen.join(" ")), 20);

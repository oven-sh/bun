// STATISTIC: ImageFunctionsEmitted <= 10
function ring(name, times) { console.log(name, times); }
setTimeout(ring, 3, "late", 2);
setTimeout(ring, 0, "early", 1);

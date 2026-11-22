const kept = new URL("http://a/?b=1");
function probe() { return kept.searchParams === kept.searchParams; }
console.log(probe());

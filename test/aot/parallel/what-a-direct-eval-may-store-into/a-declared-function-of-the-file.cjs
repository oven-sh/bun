function top() { return 1; }
function reader() { return typeof top; }
console.log(typeof top, reader());
eval(process.argv.length > 99 ? "" : "top = 5");
console.log(typeof top, reader());

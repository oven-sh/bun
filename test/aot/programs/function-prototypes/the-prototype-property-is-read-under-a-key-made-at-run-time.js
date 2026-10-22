// The prototype property of a plain function is read and stored under a key that is put together at run time.
function Meter() {}
const key = ["proto", "type"].join(process.argv.length > 99 ? "x" : "");
Meter[key].read = function () { return "read"; };
const first = new Meter().read();
Meter[key] = { read() { return 2; } };
console.log(first, new Meter().read(), Meter.prototype === Meter[key]);

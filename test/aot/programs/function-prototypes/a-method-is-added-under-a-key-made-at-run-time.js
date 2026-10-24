// A method is stored on the prototype object of a plain function under a key that is put together at run time.
function Meter() {}
Meter.prototype.read = function () { return 1; };
const key = ["re", "ad"].join(process.argv.length > 99 ? "x" : "");
Meter.prototype[key] = function () { return "text"; };
const answer = new Meter().read();
console.log(typeof answer, answer);

// An instance of a plain function is made first, and the method that it is asked for is stored on the prototype object afterwards. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
const meter = new Meter();
const before = typeof meter.read;
Meter.prototype.read = function () { return "read"; };
console.log(before, typeof meter.read, meter.read());

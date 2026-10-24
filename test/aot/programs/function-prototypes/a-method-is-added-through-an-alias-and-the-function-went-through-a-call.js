// The prototype object of a plain function is kept in a variable and handed to a function, which stores a method on it. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
function extend(target, name, method) { target[name] = method; }
const alias = Meter.prototype;
extend(alias, "read", function () { return "read " + (this.constructor === Meter); });
extend({}, "read", function () { return 5; });
console.log(new Meter().read(), Object.keys(Meter.prototype).join());

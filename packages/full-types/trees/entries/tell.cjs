// what a module's value is, told without the module: its kind, its own names, what hangs on the usual ones
exports.tell = function tell(x) {
  if (x === null || (typeof x !== "object" && typeof x !== "function")) return String(x);
  var names = Object.getOwnPropertyNames(x).filter(function (k) { return typeof x !== "function" || (k !== "length" && k !== "name" && k !== "prototype" && k !== "arguments" && k !== "caller"); }).sort();
  return typeof x + " keys[" + Object.keys(x).sort().join() + "] own[" + names.map(function (k) { return k + ":" + typeof x[k]; }).join() + "] __esModule=" + String(x.__esModule) + " default" + (x.default === x ? "=itself" : ":" + typeof x.default) + " tag=" + Object.prototype.toString.call(x);
};

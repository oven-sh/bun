// THE CORNER: the function's prototype property is given Object.prototype, so the global object IS an instance of it.
function Weird(options) {
  if (!(this instanceof Weird)) return new Weird(options);
  for (var key in options) this[key] = options[key];
}
Weird.prototype = Object.prototype;
var kept = process, said = "nothing is thrown";
try {
  Weird({ process: { pid: "replaced" }, ownName: 5 });
} catch (error) {
  said = error.constructor.name;
}
console.log(said, process.pid === kept.pid ? "and process is as it was" : process.pid, globalThis.ownName);

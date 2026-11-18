// Text that is evaluated when the program runs reads a name that lies above what it is handed: an object, a function of the program, a function of a library module.
const { EventEmitter } = require("node:events");
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
function ofTheProgram(value) {
  return value + 1;
}
const evaluated = (parameters, ...parts) => new Function(...parameters, parts.join(process.argv.length > 90 ? " " : ""));
const reader = () =>
  evaluated(["held", "n"], "let sum = 0; for (let i = 0; i < n; i++) ", "sum += held.hasOwnProperty === undefined ? 0 : 1; return sum;");
const caller = () =>
  evaluated(["held", "n"], "let sum = 0; for (let i = 0; i < n; i++) ", "sum += held.call(null, i) & 1; return sum;");
const loops = {
  "a name above an object": n => reader()({ own: 1 }, n),
  "a name above a function of the program": n => reader()(ofTheProgram, n),
  "a name above a function of a library module": n => reader()(EventEmitter.prototype.emit, n),
  "a function that the text made is called through call": n => caller()(evaluated(["value"], "return value ", "+ 1;"), n),
  "a function of the program is called through call": n => caller()(ofTheProgram, n),
};
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds));

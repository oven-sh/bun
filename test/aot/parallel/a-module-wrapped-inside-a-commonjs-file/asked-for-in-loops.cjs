var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var runs = [];
var require_plain = __commonJS((exports) => { runs.push("plain"); exports.rate = 3; });
var require_thrower = __commonJS((exports) => { runs.push("thrower"); exports.early = 1; if (runs.length) throw new Error("half way"); exports.late = 2; });
var require_first = __commonJS((exports) => { runs.push("first"); exports.before = 1; let seen = 0; for (let i = 0; i < 3; i++) seen += require_second().of; exports.seen = seen; });
var require_second = __commonJS((exports) => { runs.push("second"); let names = ""; for (let i = 0; i < 3; i++) names += Object.keys(require_first()).join() + ";"; exports.of = 5; exports.names = names; });
var require_late = __commonJS((exports) => { runs.push("late"); exports.value = 10; });
function many(n) { let s = 0; for (let i = 0; i < n; i++) s += require_plain().rate; return s; }
function caught(n) { const said = []; for (let i = 0; i < n; i++) { try { said.push(Object.keys(require_thrower()).join()); } catch (error) { said.push(error.message); } } return said.join(" | "); }
function* stepwise(n) { for (let i = 0; i < n; i++) yield require_late().value + i; }
console.log(runs.join(), many(0), runs.join());
console.log(many(5), many(2), runs.join());
console.log(caught(3), runs.join());
console.log(require_first().seen, require_second().names, runs.join());
const steps = stepwise(3);
console.log(runs.join());
console.log([...steps].join(), runs.join());

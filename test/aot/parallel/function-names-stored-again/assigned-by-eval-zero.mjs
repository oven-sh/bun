// One shape: the name of a function declaration at the top level of a module is assigned by eval: zero. Whoever reads the name behind that gets what was stored.
function h() { return "born"; }
function other() { return "other"; }
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
function read() { return h; }
function readTwice() { return [h, h]; }
function call() { try { return h(); } catch (error) { return error.name; } }
function kind() { return typeof h; }
function store() { eval("h = " + "0"); }
said.push(show(read()), show(h), call(), kind(), read() === h);
store();
said.push(show(read()), show(h), call(), kind(), Object.is(read(), h), Object.is(readTwice()[0], readTwice()[1]));
console.log(said.join(" | "));

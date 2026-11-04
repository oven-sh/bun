// One shape: the name of a function declaration at the top level of a module is added to.
function h() { return "born"; }
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
function read() { return h; }
function store() { h += "x"; }
said.push(show(read()), typeof h);
store();
said.push(typeof read() === "string" ? read().endsWith("x") : show(read()), typeof h);
console.log(said.join(" | "));

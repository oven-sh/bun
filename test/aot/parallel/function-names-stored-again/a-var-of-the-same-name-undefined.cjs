// One shape: a `var` of the name of a function declaration, with an initializer: undefined.
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
said.push(show(h));
function read() { return h; }
function h() { return "born"; }
var h = undefined;
said.push(show(read()), show(h), typeof h);
console.log(said.join(" | "));

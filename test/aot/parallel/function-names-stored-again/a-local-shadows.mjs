// One shape: a local shadows the name of a function declaration at the top level of a module: the declaration keeps its function.
function h() { return "born"; }
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
function read(v) { let h = v; return h; }
said.push(show(read(undefined)), show(read(null)), show(read(5)), show(read(h)));
said.push(show(h));
console.log(said.join(" | "));

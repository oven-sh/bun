// One shape: the name of a function declaration at the top level of a module is assigned by a loop over keys.
function h() { return "born"; }
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
function read() { return h; }
function store() { for (h in { key: 1 }); }
said.push(show(read()), typeof h);
store();
said.push(typeof read() === "string" ? read().length : show(read()), typeof h);
console.log(said.join(" | "));

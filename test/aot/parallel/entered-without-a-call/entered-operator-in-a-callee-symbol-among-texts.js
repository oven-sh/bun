// A callee joins what it is handed to a text and nobody takes the answer, one caller hands it a symbol, and the TypeError is caught with the state that the caller had stored by then.
const holder = { n: 0 };
function middle(a, b) { return a + b; }
function outer(a, b) { holder.n = 1; try { middle(a, b); holder.n = 2; } catch (e) { return e.name + holder.n; } return "none" + holder.n; }
function looped(b) { let s = ""; for (let i = 0; i < 3; i++) { try { middle("t" + i, b); s += "."; } catch { s += "!"; } } return s; }
console.log(outer("a", "b"), outer("a", Symbol("s")), looped(Symbol("s")), looped("x"));

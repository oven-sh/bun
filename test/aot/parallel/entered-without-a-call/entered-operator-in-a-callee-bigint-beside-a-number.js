// A callee subtracts what it is handed and nobody takes the answer, one caller hands it a BigInt beside a number, and the TypeError is caught with the state that the caller had stored by then.
const holder = { n: 0 };
function middle(a, b) { return a - b; }
function outer(a, b) { holder.n = 1; try { middle(a, b); holder.n = 2; } catch (e) { return e.name + holder.n; } return "none" + holder.n; }
function looped(b) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(i, b); s += "."; } catch { s += "!"; } } return s; }
console.log(outer(2, 1), outer(2, 1n), outer(2n, 1n), looped(1n), looped(1));

function f(n) { return n + 1; }
function g(n) { return n + 2; }
function k(n) { return n + 3; }
const box = { pick: JSON.parse("0") ? g : f };
function run(v) { const h = box.pick; return h(v); }
function late() { box.pick = k; return run("t"); }
console.log(`SAID ${run(1)} ${late()} ${run(2)} ${g("own")}`);

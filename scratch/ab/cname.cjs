const A = class {};
const out = [A.name];
for (let i = 0; i < 1; i++) { const C = class {}; out.push(C.name); }
{ const D = class {}; out.push(D.name); }
function f() { const E = class {}; return E.name; }
out.push(f());
if (true) { const F = class {}; const v = new F(); v.x = 1; out.push(F.name, require("node:util").inspect(v)); }
console.log(JSON.stringify(out));

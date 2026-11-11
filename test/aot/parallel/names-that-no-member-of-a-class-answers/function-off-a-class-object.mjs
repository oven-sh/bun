class Plain { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function makerOf(c) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return c.constructor; }
let out = "";
try { const F = makerOf(Plain); out = String(F("return 7")()); } catch (e) { out = e.name; }
console.log(out, new Plain().hello());

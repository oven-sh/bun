// The name is written as a text, and joined of two.
class Plain { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function maker() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Plain["constructor"]; }
function joined() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Plain[["const", "ructor"].join("")]; }
let out = ""; try { for (let i = 0; i < 300; i++) out = String(maker()("return 7")()); } catch (e) { out = e.name; }
let second = ""; try { second = String(joined()("return 8")()); } catch (e) { second = e.name; }
console.log(out, second, new Plain().hello());

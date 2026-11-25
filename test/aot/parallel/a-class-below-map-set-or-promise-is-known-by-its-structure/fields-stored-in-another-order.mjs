class G extends Map { constructor(flag) { super(); if (flag) { this.a = 1; this.n = 2; } else { this.n = 3; this.a = 4; } } m() { return this.n * 10 + this.a; } }
const said = [];
function run(one, turns, deed) { let s = 0; for (let i = 0; i < turns; i++) { try { s += one.m(); } catch (e) { s += 1000; } if (deed && i === 3) deed(one); } said.push(String(s)); return one; }
for (const f of [true, false, true]) run(new G(f), 8);
console.log(said.join(' '));

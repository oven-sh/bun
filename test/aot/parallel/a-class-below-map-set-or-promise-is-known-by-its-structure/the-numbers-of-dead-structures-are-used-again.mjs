class H extends Map { constructor() { super(); this.n = 1; } m() { return this.n + this.size; } }
const said = [];
function run(one, turns, deed) { let s = 0; for (let i = 0; i < turns; i++) { try { s += one.m(); } catch (e) { s += 1000; } if (deed && i === 3) deed(one); } said.push(String(s)); return one; }
let total = 0;
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].m(); return s; }
for (let r = 0; r < 12; r++) { for (let k = 0; k < 40; k++) { const x = new H(); x['a' + r + '_' + k] = 1; total += sum([x, x, x]); } globalThis.Bun?.gc?.(true); const late = []; for (let k = 0; k < 400; k++) { const x = new H(); x['b' + r + '_' + k] = 1; x.m = () => 7; late.push(x); } total += sum(late); }
said.push(String(total));
console.log(said.join(' '));

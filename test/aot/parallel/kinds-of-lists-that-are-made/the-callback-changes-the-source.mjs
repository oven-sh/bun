function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
for (let turn = 0; turn < 200; turn++) { said.length = 0; const source = whole.slice(); said.push(source.filter((v, k) => { if (k === 2) source[5] = "text"; if (k === 3) source[6] = 0.25; return true; }).join()); const other = whole.slice(); said.push(other.map((v, k) => { if (k === 1) other.length = 4; return v; }).length); }
console.log(said.join("\n"));

function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
for (let turn = 0; turn < 200; turn++) { said.length = 0; const kept = fractions.filter((v, k) => k & 1); said.push(kept.join(), fractions.filter(() => false).length, fractions.filter(() => true).join()); }
console.log(said.join("\n"));

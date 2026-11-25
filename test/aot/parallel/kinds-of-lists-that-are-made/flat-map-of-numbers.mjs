function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
for (let turn = 0; turn < 200; turn++) { said.length = 0; said.push(whole.flatMap((v) => [v, v]).join(), fractions.flatMap((v) => v).join(), whole.flatMap((v) => (v & 1 ? "odd" : [[v]])).length, texts.flatMap((v) => [v.length]).join()); }
console.log(said.join("\n"));

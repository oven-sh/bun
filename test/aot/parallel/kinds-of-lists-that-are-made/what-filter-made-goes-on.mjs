function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
for (let turn = 0; turn < 200; turn++) { said.length = 0; const kept = whole.filter((v) => v > 8); kept.push("text"); kept.push(1.5); kept[9] = null; said.push(JSON.stringify(kept), kept.length); const halves = fractions.filter((v) => v < 2); halves.push(NaN, -0, "text"); said.push(halves.map((v) => Object.is(v, -0) ? "-0" : String(v)).join()); }
console.log(said.join("\n"));

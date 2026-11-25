function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
for (let turn = 0; turn < 200; turn++) { said.length = 0; for (const list of [[1, , 3], [1.5, , 3.5], ["a", , "c"]]) { const made = list.map((v) => v); said.push(1 in made, made.length, JSON.stringify(made)); } }
console.log(said.join("\n"));

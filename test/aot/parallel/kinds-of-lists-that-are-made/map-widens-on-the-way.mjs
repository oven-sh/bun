function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
const answers = [1, 2, 0.5, "text", null, undefined, { a: 1 }, NaN, -0, 2 ** 31, -(2 ** 31), 7n];
for (let turn = 0; turn < 200; turn++) { said.length = 0; for (let from = 0; from < answers.length; from++) { const made = whole.map((v, k) => answers[(from + k) % answers.length]); said.push(made.map((v) => Object.is(v, -0) ? "-0" : typeof v === "object" ? JSON.stringify(v) : String(v)).join("|")); } for (const list of [fractions, texts]) said.push(list.map((v, k) => (k & 1 ? v : k)).join("|")); }
console.log(said.join("\n"));

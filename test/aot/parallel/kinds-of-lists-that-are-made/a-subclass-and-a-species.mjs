function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(12, (k) => k), fractions = pushed(12, (k) => k + 0.5), texts = pushed(12, (k) => "t" + k);
const said = [];
class Own extends Array {}
for (let turn = 0; turn < 200; turn++) { said.length = 0; const own = Own.from(whole); said.push(own.filter((v) => v > 9) instanceof Own, own.map((v) => v + 0.5).join()); const plain = whole.slice(); plain.constructor = { [Symbol.species]: function (n) { return { made: n }; } }; said.push(JSON.stringify(plain.filter((v) => v > 10))); }
console.log(said.join("\n"));

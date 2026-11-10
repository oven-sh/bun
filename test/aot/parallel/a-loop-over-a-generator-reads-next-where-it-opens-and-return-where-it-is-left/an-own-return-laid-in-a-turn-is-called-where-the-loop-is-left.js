// A loop reads `return` where it is left: what a turn has laid on the generator by then is called.
const said = [];
function* count() { try { yield 1; yield 2; } finally { said.push("its own"); } }
function leave(made, lays) { for (const each of made) { if (lays) made.return = () => { said.push("laid"); return {}; }; if (each === 1) break; } }
for (let round = 0; round < 300; round++) { if (round < 297) said.length = 0; leave(count(), round % 3 === 0); }
console.log(said.join(" "));

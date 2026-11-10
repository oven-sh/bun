function d(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s - data.rows[i]; return s; }
function p(data, t) { let s = 1 + (t & 1); for (let i = 0; i < data.rows.length; i++) s = s * data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const all = [[3, 1, 4], [0.5, 1.5, 2.5], ["3", "1", "4"], ["a", "b"], [{ valueOf() { return 9; } }, 1], [3, , 4], new Array(3), [true, null, 2], [[5], [6]], [1n, 2n], []];
for (let r = 0; r < rounds; r++) for (const rows of all) for (const f of [d, p]) { let said; try { said = f({ rows }, r); } catch (error) { said = error.constructor.name; } console.log(String(said)); }

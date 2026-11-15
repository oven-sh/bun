function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const all = [[3, 1, 4], [0.5, 1.5, 2.5], ["a", "b"], [{ valueOf() { return 9; } }, 1], [3, , 4], new Array(3), Object.freeze([3, 1, 4]), [1n, 2n], (() => { const l = [3, 1]; l[3000] = 4; return l; })()];
for (let r = 0; r < rounds; r++) for (const rows of all) { let said; try { said = f({ rows }, r); } catch (error) { said = error.constructor.name; } console.log(String(said)); }

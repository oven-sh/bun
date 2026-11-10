function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const all = [{ rows: "3141" }, { rows: new Uint8Array([3, 1, 4]) }, { rows: { length: 3, 0: 3, 1: 1, 2: 4 } }, { rows: 7 }, { rows: null }, {}, { rows: [3, 1, 4] }, 5, "text"];
for (let r = 0; r < rounds; r++) for (const data of all) { let said; try { said = f(data, r); } catch (error) { said = error.constructor.name; } console.log(String(said)); }

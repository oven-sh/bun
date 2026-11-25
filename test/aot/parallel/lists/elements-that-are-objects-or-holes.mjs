// Flags: --aot-harden=proof-checks --aot-testing=AssumeArithmeticElementUsers
// What is read may be an object, a number or a hole. It is asked for its shape, and then told from undefined.
function tells(list, v) { let t = 0, missing = 0; for (let i = 0; i < list.length; i++) { const row = list[i]; const a = row[0], b = row[1]; if (a === v) t += b; if (b === undefined) missing++; } return [t, missing].join(); }
function seek(list, v) { let t = 0; for (let i = 0; i < list.length; i++) { const row = list[i]; const a = row[0], b = row[1]; if (a === v) t += b; } return t; }
const rows = [];
for (let k = 0; k < 9; k++) rows.push(k % 3 === 1 ? [{ z: 1 }, 1] : k % 3 === 2 ? [k + 0.5] : [k, k + 1.5]);
for (const v of ["none", 3, 2.5]) console.log(tells(rows, v), seek(rows, v));

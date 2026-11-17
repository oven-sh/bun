// STATISTIC: VariableReceiverGuardsHoisted >= 1
const q = Number(process.argv[2] ?? 3);
var rows = JSON.parse('[]');
function f(t) { let s = t & 1; for (let i = 0; i < rows.length; i++) s = s + rows[i]; return s; }
const said = []; for (let t = 0; t < 40; t++) { said.push(f(t)); if (t === 20) rows.push(q, 2.5); if (t === 30) rows.push('x'); } console.log(said[0], said[20], said[21], said[31], said[39]);

// STATISTIC: VariableReceiverGuardsHoisted >= 1
const q = Number(process.argv[2] ?? 3);
var rows = JSON.parse('[1,2,3,4,5,6]'); let calls = 0;
function touch(i, t) { calls++; if (t === 25 && i === 1) rows[3] = 'x' + q; if (t === 30 && i === 2) rows.length = 4; if (t === 35 && i === 0) rows[9] = q; }
function f(t) { let s = t & 1; for (let i = 0; i < rows.length; i++) { touch(i, t); s = s + rows[i]; } return s; }
const said = []; for (let t = 0; t < 40; t++) said.push(f(t)); console.log(said[0], said[25], said[26], said[30], said[35], said[39], calls);

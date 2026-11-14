// STATISTIC: VariableReceiverGuardsHoisted >= 1
const q = Number(process.argv[2] ?? 3);
function f(t) { let s = t & 1; for (let i = 0; i < rows.length; i++) s = s + rows[i]; return s; }
function g(t) { let s = t & 1; for (let i = 0; i < never.length; i++) s = s + never[i]; return s; }
function tried(h, t) { try { return h(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const said = [tried(f, 1), tried(g, 1)];
var rows = JSON.parse('[1.5,2,' + q + ']');
if (q > 100) var never = JSON.parse('[4,5]');
for (let t = 0; t < 40; t++) said[2] = tried(f, t), said[3] = tried(g, t);
console.log(said.join());

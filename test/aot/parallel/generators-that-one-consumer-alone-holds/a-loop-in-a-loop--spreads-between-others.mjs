const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps(limit) { for (let i = 0; i < limit; i++) { for (let j = 0; j <= i; j++) yield i * 10 + j; note("row " + i); } }
function consume() {  if (isEndless) return "endless"; const all = [-1, ...steps(3), -2, ...steps(3)]; return all.length + ": " + all.map(value => typeof value).join(); }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps(list, change) { for (const item of list) yield change(item); }
function consume() {  let sum = 0; let turns = 0; for (const value of steps([3, 1, 4, 1, 5], item => item * 2)) { sum += typeof value === "number" ? value : 1000; if (++turns > 12) break; } return sum + " in " + turns; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

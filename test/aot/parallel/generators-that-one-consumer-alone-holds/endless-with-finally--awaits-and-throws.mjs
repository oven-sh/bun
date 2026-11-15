const notes = [];
let silent = false;
const isEndless = true;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps() { try { for (let i = 0; ; i++) yield i; } finally { note("stopped"); } }
async function consume() {  let turns = 0; for (const value of steps()) { await Promise.resolve(1); if (++turns === 2) throw new Error("late"); } return turns; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

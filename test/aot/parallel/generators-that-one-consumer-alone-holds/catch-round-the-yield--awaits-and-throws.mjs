const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps(limit) { for (let i = 0; i < limit; i++) { try { yield i; if (i === 1) throw new Error("own " + i); } catch (error) { note("caught " + error.message); yield 100 + i; } } }
async function consume() {  let turns = 0; for (const value of steps(4)) { await Promise.resolve(1); if (++turns === 2) throw new Error("late"); } return turns; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

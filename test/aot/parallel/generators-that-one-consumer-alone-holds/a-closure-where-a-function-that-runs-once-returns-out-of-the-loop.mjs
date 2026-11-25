const notes = [];
let silent = false;
let round = 0;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; note("ran out"); } finally { note("cleaned up"); } }
function search() {  for (const value of steps(4)) { if (typeof value === "number" && value > 0) { const step = (value * 5) | 0, isOdd = (value & 1) === 1; return () => step + (isOdd ? 1 : 0); } } return null; }
function consume() { const made = search(); return made === null ? "none" : made(); }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
round = 1; const answer = await attempt(); console.log(answer + " | " + notes.join("; "));

const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* inner(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("inner cleaned"); } }
function* steps(limit) { for (const value of inner(limit)) { note("passing " + value); yield value * 10; } note("outer end"); }
function consume() {  let sum = 0; let turns = 0; try { for (const value of steps(4)) { sum += typeof value === "number" ? value : 1000; if (++turns === 3) throw new Error("third"); } } catch (error) { return "caught " + error.message + " at " + sum; } return sum; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

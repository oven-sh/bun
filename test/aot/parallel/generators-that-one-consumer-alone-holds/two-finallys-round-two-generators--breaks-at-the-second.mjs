const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* innermost(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { note("innermost cleaned"); } }
function* inner(limit) { try { for (const value of innermost(limit)) yield value * 2; } finally { note("inner cleaned"); } }
function* steps(limit) { try { for (const value of inner(limit)) yield value + 1; } finally { note("outer cleaned"); } }
function consume() {  let turns = 0; for (const value of steps(3)) { note("got " + (typeof value === "function" ? "f" + value() : String(value))); if (++turns === 2) break; } return turns; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

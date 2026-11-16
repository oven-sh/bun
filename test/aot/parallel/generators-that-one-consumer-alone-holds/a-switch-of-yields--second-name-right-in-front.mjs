const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* steps(limit) { for (let i = 0; i < limit; i++) { switch (i % 3) { case 0: yield "zero"; break; case 1: yield "one"; default: yield "other " + i; } } }
function consume() {  let turns = 0; const held = steps(5); for (const value of held) { note("got " + (typeof value === "function" ? "f" + value() : String(value))); if (++turns === 2) break; } const after = held.next(); return typeof after.value + " " + after.done; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

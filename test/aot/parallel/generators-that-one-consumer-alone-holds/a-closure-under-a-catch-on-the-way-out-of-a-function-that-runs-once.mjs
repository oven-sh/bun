const notes = [];
let silent = false;
let round = 0;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* inner(limit) { for (let i = 0; i < limit; i++) yield i; }
function* steps(limit) { try { for (const value of inner(limit)) yield value; } finally { note("outer cleaned"); } }
function consume() {  let found = null; try { for (const value of steps(4)) { if (typeof value === "number" && value > 1) { const step = (value * 7) | 0; found = () => step; throw new Error("out"); } } } catch (error) { note("caught " + error.message); } return found === null ? "none" : found(); }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
round = 1; const answer = await attempt(); console.log(answer + " | " + notes.join("; "));

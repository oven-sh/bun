const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
function* inner(names, start) { for (const name of names) if (name.startsWith(start)) yield name; }
function* steps(shelf, keys, skipped, own) { for (const key of keys) { for (const start of shelf.get(key) ?? []) { if (skipped.includes(start)) continue; for (const name of inner(["a1", "b1", "a2", "c1", "b2"], start)) { if (!own.has(name)) yield name; } } } }
function consume() {  let sum = 0; let turns = 0; try { for (const value of steps(new Map([["x", ["a", "b"]], ["z", ["c"]]]), ["x", "y", "z"], ["q"], new Set(["a2"]))) { sum += typeof value === "number" ? value : 1000; if (++turns === 3) throw new Error("third"); } } catch (error) { return "caught " + error.message + " at " + sum; } return sum; }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

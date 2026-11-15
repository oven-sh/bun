const notes = [];
let silent = false;
const isEndless = false;
const flag = process.argv.length > 0;
const box = JSON.parse('{"limit":0,"name":"box"}');
function pick(wanted) { if (wanted < 0) return 0; return flag ? wanted : wanted - 1; }
function note(text) { if (!silent) notes.push(text); }
class Shelf { constructor() { this.books = [10, 20, 30]; this.bonus = 1; } *each(extra) { for (let i = 0; i < this.books.length; i++) yield this.books[i] + this.bonus + extra; } }
const shelf = new Shelf();
function consume() {  if (isEndless) return "endless"; const all = [-1, ...shelf.each(2), -2, ...shelf.each(2)]; return all.length + ": " + all.map(value => typeof value).join(); }
async function attempt() { try { return "gave " + String(await consume()); } catch (error) { return "threw " + (error && error.message); } }
for (let call = 0; call < 3; call++) { notes.length = 0; const answer = await attempt(); console.log(answer + " | " + notes.join("; ")); }

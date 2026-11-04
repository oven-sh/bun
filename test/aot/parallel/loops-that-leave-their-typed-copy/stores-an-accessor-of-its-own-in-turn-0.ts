// stores: an accessor of its own, in turn 0
let subject: any;
let reads = 0;
let armed = false;
function between(i: number) { if (armed && i === 0) { armed = false; Object.defineProperty(subject, "length", { get() { reads++; return 3; }, configurable: true }); } }
function ask(view: Uint8Array) { for (let i = 0; i < view.length; i++) { between(i); view[i] = i * 2 + 1; } return Array.prototype.join.call(view, ""); }
function fresh() { const view = new Uint8Array(5); for (let i = 0; i < 5; i++) view[i] = i + 1; return view; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(String(ask(view))); } catch (error) { seen.push((error as Error).name); } }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
subject = fresh();
armed = true;
look(subject);
look(subject);
look(plain);
seen.push(reads);
console.log(seen.join());

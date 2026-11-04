// a while: another prototype, in turn 4
let subject: any;
let reads = 0;
let armed = false;
function between(i: number) { if (armed && i === 4) { armed = false; Object.setPrototypeOf(subject, { __proto__: Uint8Array.prototype, get length() { return 3; } }); } }
function ask(view: Uint8Array) { let i = 0, total = 0; while (i < view.length) { between(i); total += view[i]; i++; } return total + ":" + i; }
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

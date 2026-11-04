// in a loop, the position , added to, a view that follows its buffer: the buffer shrinks
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const made = new Uint8Array(buffer);
const longer = new Uint8Array(buffer, 0);
const apart = new Uint8Array(12);
for (let i = 0; i < 8; i++) made[i] = i + 1;
(globalThis as any).deeds = [() => buffer.resize(2)];
let turns = 0;
function between() { if (++turns === 5) { buffer.resize(2); } }
function ask(view: Uint8Array, i: number) { let said = ""; for (let j = 0; j < view.length; j++) { between(); said += (view[j] += 2) + ";"; } return said; return "outside"; }
const seen: unknown[] = [];
for (const i of [0, 1, 7, 3, 1, 8, -1, 1.5, NaN, 4294967296, 2]) { try { seen.push(String(ask(made, i))); } catch (error) { seen.push((error as Error).name); } }
try { buffer.resize(16); seen.push(new Uint8Array(buffer).join("")); } catch (error) { seen.push((error as Error).name); }
console.log(seen.join());

// the length above, the position as an integer, read, a view of a fixed length: the buffer shrinks through another view
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const made = new Uint8Array(buffer, 0, 8);
const longer = new Uint8Array(buffer, 0);
const apart = new Uint8Array(12);
for (let i = 0; i < 8; i++) made[i] = i + 1;
(globalThis as any).deeds = [() => buffer.resize(2)];
let turns = 0;
function between() { if (++turns === 3) { (longer.buffer as ArrayBuffer).resize(2); } }
function ask(view: Uint8Array, i: number) { const k = i | 0; if (view.length > k) { between(); return view[k]; } return "outside"; }
const seen: unknown[] = [];
for (const i of [0, 1, 7, 3, 1, 8, -1, 1.5, NaN, 4294967296, 2]) { try { seen.push(String(ask(made, i))); } catch (error) { seen.push((error as Error).name); } }
try { buffer.resize(16); seen.push(new Uint8Array(buffer).join("")); } catch (error) { seen.push((error as Error).name); }
console.log(seen.join());

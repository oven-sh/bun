type Point = { x: number; y: number };
const out: unknown[] = [];
function say(...all: unknown[]) { out.push(all.map(one => { try { return typeof one === "object" ? JSON.stringify(one) : String(one); } catch (e) { return "unprintable"; } }).join(" ")); }
function attempt(run: () => unknown) { try { say("gave", run()); } catch (e) { say("threw", (e as Error).constructor.name, (e as Error).message); } }
const box: { points: unknown } = { points: Object.assign([{ x: 1, y: 2 }], { [Symbol.iterator]: function* () { say("its own iterator runs"); yield { x: 9, y: 9 }; } }) };
function all(from: { points: unknown }): Point[] { return from.points as Point[]; }
function count(from: { points: unknown }) { const points = all(from); return [points.length, points[0], points[1]]; }
function walk(from: { points: unknown }) { const seen: unknown[] = []; for (const p of all(from)) seen.push(p.x, p.y); return seen; }
for (let turn = 0; turn < 2; turn++) { attempt(() => count(box)); attempt(() => walk(box)); }

console.log(out.join("\n"));

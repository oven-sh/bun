type Point = { x: number; y: number };
const out: unknown[] = [];
function say(...all: unknown[]) { out.push(all.map(one => { try { return typeof one === "object" ? JSON.stringify(one) : String(one); } catch (e) { return "unprintable"; } }).join(" ")); }
function attempt(run: () => unknown) { try { say("gave", run()); } catch (e) { say("threw", (e as Error).constructor.name, (e as Error).message); } }
const box: { point: unknown } = { point: new Proxy({ x: 1, y: 2 }, { get(target, key) { say("the proxy is asked for", String(key)); return Reflect.get(target, key); } }) };
function pick(from: { point: unknown }): Point { return from.point as Point; }
function sum(from: { point: unknown }) { const p = pick(from); return [p.x, p.y, p.x + p.y]; }
function store(from: { point: unknown }) { "use strict"; const p = pick(from); p.x = 5; p.y = 6; return [p.x, p.y]; }
for (let turn = 0; turn < 3; turn++) { attempt(() => sum(box)); }
attempt(() => store(box));
attempt(() => sum(box));

console.log(out.join("\n"));

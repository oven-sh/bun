const at: number[] = JSON.parse("[0,1]");
class Point { x = 1; }
const isList = Array.isArray.bind(null);
const frozen = Object.freeze.bind(null);
function call(pick: number, p: Point): unknown { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; const f: (v: Point) => unknown = pick ? frozen : isList; return f(p); }
function show(list: number[]): string { let out = ""; for (let i = 0; i < list.length; i++) { const p = new Point(); const r = call(list[i]!, p); try { p.x = 5; } catch (e) { out += "threw "; } out += `${typeof r} ${p.x} ${Object.isFrozen(p)},`; } return out; }
console.log(show(at));

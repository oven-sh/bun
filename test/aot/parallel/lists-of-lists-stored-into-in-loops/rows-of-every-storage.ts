const unseen = (x: any): any => [x][JSON.parse("0")];
const one = (v: any): string => (Array.isArray(v) ? show(v) : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
function show(x: any, depth = 0): string { if (!Array.isArray(x)) return JSON.stringify(x); if (depth > 2) return "[..]"; let s = "["; for (let i = 0; i < x.length; i++) s += (i ? "," : "") + (i in x ? (Array.isArray(x[i]) ? show(x[i], depth + 1) : one(x[i])) : "hole"); return s + "]"; }
const pushed = (...values: any[]): any => { const a: any[] = []; for (let i = 0; i < values.length; i++) a.push(values[i]); return unseen(a); };
const tell = (f: any, ...a: any[]) => { try { f(...a); return show(a[0]); } catch (e: any) { return e.constructor.name + " " + show(a[0]); } };
function fill(grid: number[][], v: number): void { for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) grid[y][x] = v + x; }
function bump(grid: number[][]): void { for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) grid[y][x] += 0.5; }
function copy(rows: number[][], out: number[]): void { for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r].length; i++) out[i] = rows[r][i]; }
const holed = () => { const a = pushed(1.5, 2.5, 3.5); delete a[1]; return a; };
const make = () => pushed(pushed(0.5, 0.5), pushed(1, 2), pushed("a", 2.5), holed(), pushed(), [5.5, 6.5], Object.freeze(pushed(7.5, 8.5)));
for (let n = 0; n < 2; n++) { console.log(tell(fill, make(), 0.25), tell(bump, make())); const out = pushed(0.5, 0.5, 0.5); let t = ""; try { copy(make(), out); t = "ran"; } catch (e: any) { t = e.constructor.name; } console.log(t, show(out)); console.log(tell(fill, pushed(pushed(0.5), null, pushed(1.5)), 0.25), tell(bump, pushed(pushed(0.5), undefined)), tell(fill, pushed(pushed(0.5, 0.5)), NaN), tell(fill, holedGrid(), 0.25)); }
function holedGrid() { const g = pushed(pushed(0.5), pushed(1.5), pushed(2.5)); delete g[1]; return g; }

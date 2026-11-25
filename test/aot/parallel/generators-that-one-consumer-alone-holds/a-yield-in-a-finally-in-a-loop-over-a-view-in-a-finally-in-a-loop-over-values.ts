// list levels=list+view in gen deed=list by getter at=2 second run alone stop=1 n=9: typed forms expected: yes
const out: string[] = [], fs: any[] = [], cells: any[] = [0, 0, 0, 0];
let noted = 0, hash = 7, self: any = null, at: number = JSON.parse("1000000000"); const stop: number = JSON.parse("1");
const box: any = { v: 0, rest: 0, set s(w: any) { note(w); box.v = w; } };
function show(x: any, depth: any = 0): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x;
  if (typeof x === "string") return x.length > 24 ? "s" + x.length : JSON.stringify(x);
  if (x === null || typeof x !== "object") return typeof x === "function" ? "F" : String(x)[0];
  if (depth > 1) return "..";
  if (Array.isArray(x)) { let t = "["; for (let i = 0; i < x.length && i < 12; i++) t += (i in x ? show(x[i], depth + 1) : "!") + " "; return t + x.length + "]"; }
  if (x instanceof Map || x instanceof Set) return "M" + x.size;
  let t = "{"; for (const k of Object.keys(x)) t += k + show(x[k], depth + 1); return t + "}";
}
function note(v: any): any { const t = show(v); noted++; for (let i = 0; i < t.length; i++) hash = (Math.imul(hash, 31) + t.charCodeAt(i)) | 0; if (noted <= 70) out.push(t); return v; }
function said(e: any): string { return e instanceof Error ? e.name : "!" + show(e); }
function disturb(d: any): any { try { d.length = 0; } catch (e) { note(said(e)); } return 0; }
let cur: any = null; const trap = { get go(): any { disturb(cur); return 1; } };
function grow(n: number, f: (i: number) => any): any[] { const l: any[] = []; for (let i = 0; i < n; i++) l.push(f(i)); return l; }
const in0: number[] = grow(9, i => i * 1073741824);
const in1: Float64Array = new Float64Array(grow(2, i => (i & 1 ? -0 : i)));
function* run(a: number[], b: Float64Array): any { let s = 0, turns = 0, fired = 0; let x0: any = "none";  for (x0 of a.values()) { turns++; if (turns >= at && fired === 0) { fired = 1; cur = a; s += trap.go; } s += x0; if (turns === stop) break; try { for (let x1 of b) { turns++; try { if (x1 > 2) s++; yield x1; } finally { note(turns);  } } } finally { note("z"); if (turns === stop) break; } note(x0); } note(x0);  }
try { for (const y of run(in0, in1)) note(y); } catch (e) { note(said(e)); }
at = 2;
try { const [g0, g1]: any = run(in0, in1); note(g0); note(g1); } catch (e) { note(said(e)); }
for (const f of fs.slice(0, 4)) try { note(f()); } catch (e) { note(said(e)); }
try { note(in0); } catch (e) { note(said(e)); }
try { note(in1); } catch (e) { note(said(e)); }
console.log(out.join(" "), noted, hash);
export {};

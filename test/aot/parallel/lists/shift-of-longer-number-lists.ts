const out: string[] = [];
function text(v: any): string { return v === undefined ? "u" : v === null ? "n" : typeof v === "function" ? "f" + v() : Array.isArray(v) ? "[" + v.map(text).join() + "]" : typeof v === "object" ? "o" + v.id + v.next : Object.is(v, -0) ? "-0" : String(v); }
let hash = 0; function note(s: string): void { for (let k = 0; k < s.length; k++) hash = (Math.imul(hash, 31) + s.charCodeAt(k)) | 0; }
function end(name: string, l: any): void { let s = l.length + ":"; for (let k = 0; k < l.length && k < 9; k++) s += (k in l ? text(l[k]) : "_") + ","; out.push(name + " " + hash + " " + s); hash = 0; }
const sizes = [0, 1, 2, 16, 17, 18, 31, 32, 33, 34, 60, 64, 65, 100, 127, 128, 129, 130, 131, 200];

function make(n: number): number[] { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i === 90 ? 0.5 : i); return l; }
for (const n of sizes) {
  { const l: number[] = make(n); for (let k = 0; k < n + 2; k++) { const v = l.shift(); note(text(v)); if (k === n >> 1) end("half" + n, l); } end("all" + n, l); }
  { const l: number[] = []; let i = 0; for (const v of make(n * 2)) { l.push(v); if (l.length > n) note(text(l.shift())); i++; } end("queue" + n, l); }
  { const l: number[] = make(n); let total = 0; while (l.length > 3) { const v = l.shift()!; total++; if (total % 4 === 0) l.push(v); if (total > 900) break; note(text(v)); } end("round" + n, l); }
  { const l: number[] = make(n); if (n > 40) { delete (l as any)[20]; delete (l as any)[35]; } for (let k = 0; k < 45; k++) note(text(l.shift())); end("holes" + n, l); }
  { const l: number[] = make(n); delete (l as any)[0]; for (let k = 0; k < 3; k++) note(text(l.shift())); end("first" + n, l); }
  { const l: any[] = make(n); for (let k = 0; k < 60; k++) { const v = l.shift(); if (k === 20) l.push("text"); if (k === 25) l.push(0.5); if (k === 30) l.push({ id: 1, next: 2 }); if (k === 35) l.length = l.length >> 1; note(text(v)); } end("kinds" + n, l); }
  { const l: number[] = make(n); const kept: any[] = []; for (let k = 0; k < n; k++) { kept.push(l.shift()); if (k % 16 === 0) for (let g = 0; g < 50; g++) kept.push(new Array(60).fill(g).length); } note(kept.map(text).join()); end("garbage" + n, l); }
  { const l: number[] = make(n); Object.freeze(l); try { for (let k = 0; k < 3; k++) note(text(l.shift())); } catch (e: any) { note(e.name); } end("frozen" + n, l); }
  { class L extends Array<number> { } const l = new L(); for (const v of make(n)) l.push(v); for (let k = 0; k < 50; k++) note(text(l.shift())); end("class" + n, l); }
  { const l: any = { length: n }; for (let k = 0; k < n; k++) l[k] = k; for (let k = 0; k < 5; k++) note(text(Array.prototype.shift.call(l))); out.push("like" + n + hash + l.length); hash = 0; }
  { const l: number[] = make(n); try { for (let k = 0; k < 40; k++) { note(text(l.shift())); if (k === 33) throw new Error("x"); } } catch (e: any) { note(e.message); } end("try" + n, l); }
}
console.log(out.join("\n"));

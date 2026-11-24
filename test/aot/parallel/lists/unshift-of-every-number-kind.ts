const out: string[] = [];
function text(v: any): string { return v === undefined ? "u" : v === null ? "n" : typeof v === "function" ? "f" + v() : Array.isArray(v) ? "[" + v.map(text).join() + "]" : typeof v === "object" ? "o" + v.id + v.next : Object.is(v, -0) ? "-0" : String(v); }
let hash = 0; function note(s: string): void { for (let k = 0; k < s.length; k++) hash = (Math.imul(hash, 31) + s.charCodeAt(k)) | 0; }
function end(name: string, l: any): void { let s = l.length + ":"; for (let k = 0; k < l.length && k < 9; k++) s += (k in l ? text(l[k]) : "_") + ","; out.push(name + " " + hash + " " + s); hash = 0; }
const sizes = [0, 1, 2, 16, 17, 18, 31, 32, 33, 34, 60, 64, 65, 100, 127, 128, 129, 130, 131, 200];

function make(n: number): number[] { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i === 90 ? 0.5 : i); return l; }
for (const n of sizes) {
  { const l: number[] = make(n); let c = 0; for (const v of make(40)) { c += l.unshift(v); } note(String(c)); end("front" + n, l); for (const v of l) note(text(v)); end("whole" + n, l); }
  { const l: number[] = make(n); for (let k = 0; k < n; k++) { const v = l.pop()!; l.unshift(v); if (k % 3 === 0) note(text(l[k >> 1])); } end("turn" + n, l); for (const v of l) note(text(v)); end("turned" + n, l); }
  { const l: number[] = make(n); for (let k = 0; k < 20 && l.length; k++) { const at = (k * 7) % l.length; const v = l[at]!; l.splice(at, 1); l.unshift(v); note(text(v)); } end("move" + n, l); for (const v of l) note(text(v)); end("moved" + n, l); }
  { const l: number[] = make(n); if (n > 40) { delete (l as any)[20]; delete (l as any)[n - 1]; } for (const v of make(9)) l.unshift(v); end("holes" + n, l); for (let k = 0; k < l.length; k++) note(k in l ? text(l[k]) : "_"); end("hole" + n, l); }
  { const l: any[] = make(n); for (const v of [5, 0.5, NaN, -0, "x", { id: 1, next: 2 }, undefined, null, 7n, 2147483648, true]) { note(String(l.unshift(v))); note(text(l[0])); l.unshift(1); } end("kinds" + n, l); for (const v of l) note(text(v)); end("kind" + n, l); }
  { const l: any[] = []; for (let k = 0; k < n; k++) { l.unshift(k === 90 ? 0.5 : k as any); if (k % 16 === 0) for (let g = 0; g < 50; g++) note(String(new Array(60).fill(g).length)); } end("garbage" + n, l); for (const v of l) note(text(v)); end("kept" + n, l); }
  { const l: number[] = make(n); Object.freeze(l); try { for (const v of make(3)) note(String(l.unshift(v))); } catch (e: any) { note(e.name); } end("frozen" + n, l); }
  { const l: number[] = make(n); Object.preventExtensions(l); try { for (const v of make(3)) note(String(l.unshift(v))); } catch (e: any) { note(e.name); } end("closed" + n, l); }
  { const l: number[] = make(n); Object.defineProperty(l, "length", { writable: false }); try { for (const v of make(3)) note(String(l.unshift(v))); } catch (e: any) { note(e.name); } end("length" + n, l); }
  { class L extends Array<number> { } const l = new L(); for (const v of make(n)) l.unshift(v); note(String(l.unshift())); end("class" + n, l); }
  { const l: any[] = make(n); note(String(l.unshift(1, 2, 3))); note(String(l.unshift(...make(4)))); end("many" + n, l); }
  { const l: any = { length: n }; for (let k = 0; k < n; k++) l[k] = k; note(String(Array.prototype.unshift.call(l, 9))); out.push("like" + n + hash + l.length + l[0] + l[1]); hash = 0; }
  { const l: any[] = [1, 2, 3]; const shared = [1, 2, 3, 4]; l.unshift(shared.unshift(0)); end("literal" + n, l); end("shared" + n, shared); }
}
console.log(out.join("\n"));

// a part of a view is read like the view.
const view = new Uint8Array(64); for (let i = 0; i < 64; i++) view[i] = i * 3;
function sum(v, from, to) { let s = 0; for (let j = from; j < to; j++) s = s + v[j]; return s; }
function sumOfPart(v) { const p = v.subarray(8, 40); let s = 0; for (let j = 0; j < p.length; j++) s = s + p[j]; return s; }
function sumOfCopy(v) { const p = v.slice(8, 40); let s = 0; for (let j = 0; j < p.length; j++) s = s + p[j]; return s; }
function sumOfWhatFromMakes(v) { const p = Uint8Array.from(v); let s = 0; for (let j = 8; j < 40; j++) s = s + p[j]; return s; }
export const loops = {
  "a view between two positions": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (sum(view, 8, 40))) | 0; return s; },
  "a part of a view": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (sumOfPart(view))) | 0; return s; },
  "a copy of a part of a view": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (sumOfCopy(view))) | 0; return s; },
  "a view that from makes": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (sumOfWhatFromMakes(view))) | 0; return s; },
};

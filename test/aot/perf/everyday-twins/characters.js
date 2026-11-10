// a text is walked by a function out of a table.
const text = JSON.parse('"a,bc,def,ghij,klmno,p"'), key = JSON.parse('["codes","index","charAt","forOf","bitsInside","bitsFromBehind"]');
const table = {
  codes(s) { let n = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 44) n++; return n; },
  index(s) { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === ",") n++; return n; },
  charAt(s) { let n = 0; for (let i = 0; i < s.length; i++) if (s.charAt(i) === ",") n++; return n; },
  forOf(s) { let n = 0; for (const c of s) if (c === ",") n++; return n; },
  bitsInside(s) { const bits = new Int32Array(s.length + 5); let n = 0; for (let j = s.length; j >= 1; j -= 1) { bits[j] = ((bits[j + 1] << 1) | 1) & (s.charAt(j - 1) === "," ? 3 : 1); n += bits[j]; } return n; },
  bitsFromBehind(s) { const bits = new Int32Array(s.length + 5); let n = 0; for (let j = s.length + 3; j >= 1; j -= 1) { bits[j] = ((bits[j + 1] << 1) | 1) & (s.charAt(j - 1) === "," ? 3 : 1); n += bits[j]; } return n; },
};
function seen(s) { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === ",") n++; return n; }
export const loops = {
  "characters by index, the caller seen": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (seen(text))) | 0; return s; },
  "characters by code": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[0]](text))) | 0; return s; },
  "characters by index": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[1]](text))) | 0; return s; },
  "characters by charAt": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[2]](text))) | 0; return s; },
  "bits by charAt": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[4]](text))) | 0; return s; },
  "bits by charAt, begun behind the end": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[5]](text))) | 0; return s; },
  "characters by a for-of": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[3]](text))) | 0; return s; },
};

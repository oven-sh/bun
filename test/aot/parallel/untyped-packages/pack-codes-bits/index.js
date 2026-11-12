// text packed by prefix codes, by dictionaries and by runs; all three unpacked again
'use strict';
class Bits { constructor(bytes = []) { this.bytes = bytes; this.n = 0; this.at = 0; } put(v, w) { for (let i = w - 1; i >= 0; i--) { if (this.n % 8 === 0) this.bytes.push(0); if (v >> i & 1) this.bytes[this.n >> 3] |= 128 >> this.n % 8; this.n++; } } get(w = 1) { let v = 0; while (w--) { v = v << 1 | this.bytes[this.at >> 3] >> 7 - this.at % 8 & 1; this.at++; } return v; } }
function huffman(text) {
  const freq = new Map(); for (const c of text) freq.set(c, (freq.get(c) ?? 0) + 1);
  let nodes = [...freq].map(([c, n]) => ({ c, n, low: c })).sort((a, b) => a.n - b.n || (a.low < b.low ? -1 : 1));
  if (!nodes.length) return { codes: new Map(), bits: new Bits(), length: 0, tree: null };
  while (nodes.length > 1) { const [a, b] = nodes.splice(0, 2), n = { n: a.n + b.n, a, b, low: a.low < b.low ? a.low : b.low }; let i = 0; while (i < nodes.length && (nodes[i].n < n.n || nodes[i].n === n.n && nodes[i].low < n.low)) i++; nodes.splice(i, 0, n); }
  const codes = new Map(); (function walk(n, code) { if (n.c !== undefined) codes.set(n.c, code || '0'); else { walk(n.a, code + '0'); walk(n.b, code + '1'); } })(nodes[0], '');
  const bits = new Bits(); for (const c of text) for (const b of codes.get(c)) bits.put(+b, 1);
  return { codes, bits, length: [...text].length, tree: nodes[0] };
}
function unhuffman(p) { let out = ''; for (let i = 0; i < p.length; i++) { let n = p.tree; if (n.c !== undefined) { p.bits.get(); out += n.c; continue; } while (n.c === undefined) n = p.bits.get() ? n.b : n.a; out += n.c; } return out; }
function lzw(text) { let dict = {}, size = 256, w = '', out = []; for (let i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i; for (let i = 0; i < text.length; i++) { const c = text.charAt(i), wc = w + c; if (Object.prototype.hasOwnProperty.call(dict, wc)) w = wc; else { out.push(dict[w]); dict[wc] = size++; w = c; } } if (w !== '') out.push(dict[w]); return out; }
function unlzw(codes) { if (!codes.length) return ''; let dict = [], w = String.fromCharCode(codes[0]), out = w; for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i); for (let i = 1; i < codes.length; i++) { const k = codes[i]; let entry; if (dict[k] !== undefined) entry = dict[k]; else if (k === dict.length) entry = w + w.charAt(0); else throw new RangeError('bad code ' + k + ' at ' + i); out += entry; dict.push(w + entry.charAt(0)); w = entry; } return out; }
function lz77(s, win = 64) { const out = []; let i = 0; while (i < s.length) { let best = 0, dist = 0; for (let j = Math.max(0, i - win); j < i; j++) { let k = 0; while (i + k < s.length && s[j + k] === s[i + k] && k < 18) k++; if (k >= best && k > 2) { best = k; dist = i - j; } } if (best) { out.push([dist, best]); i += best; } else out.push(s[i++]); } return out; }
function unlz77(list) { const out = []; for (const x of list) { if (typeof x === 'string') out.push(x); else { const [d, n] = x; for (let k = 0; k < n; k++) out.push(out[out.length - d]); } } return out.join(''); }
const rle = s => s.replace(/([\s\S])\1{2,}/g, (m, c) => c + '\x01' + String.fromCharCode(m.length + 32)), unrle = s => s.replace(/([\s\S])\x01([\s\S])/g, (m, c, n) => c.repeat(n.charCodeAt(0) - 32));
function bwt(s) { const t = s + '\x00', rows = Array.from(t, (_, i) => i).sort((a, b) => { for (let k = 0; k < t.length; k++) { const x = t.charCodeAt((a + k) % t.length), y = t.charCodeAt((b + k) % t.length); if (x !== y) return x - y; } return 0; }); return rows.map(i => t[(i + t.length - 1) % t.length]).join(''); }
function unbwt(s) { const n = s.length, count = {}, rank = []; for (let i = 0; i < n; i++) { count[s[i]] = (count[s[i]] || 0) + 1; rank[i] = count[s[i]] - 1; } const first = {}; let sum = 0; for (const c of Object.keys(count).sort()) { first[c] = sum; sum += count[c]; } let out = '', i = 0; for (let k = 0; k < n - 1; k++) { const c = s[i]; out = c + out; i = first[c] + rank[i]; } return out; }
const mtf = s => { const list = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)); return [...s].map(c => { const i = list.indexOf(c); if (i > 0) { list.splice(i, 1); list.unshift(c); } return i; }); };
module.exports = { Bits, huffman, unhuffman, lzw, unlzw, lz77, unlz77, rle, unrle, bwt, unbwt, mtf };

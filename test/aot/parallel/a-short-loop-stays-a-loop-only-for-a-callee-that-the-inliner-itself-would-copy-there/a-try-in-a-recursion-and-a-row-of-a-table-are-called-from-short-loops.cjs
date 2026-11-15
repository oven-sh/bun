'use strict';
// Two callees that a short loop calls and that no copy in the loop pays for: one holds a try and calls itself, one is a template of thirty operations. Beside them one of a size that loops copy.
const data = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => i * 37 % 64).join() + ']');
function walk(n) { if (n <= 0) throw new Error('floor'); try { return data[n & 63] + walk(n - 7); } catch (e) { if (n > 56) return 1; throw e; } }
function sums(t) { let s = t & 1; for (let i = 57; i < 64; i++) s += walk(i); return s; }
const rows = JSON.parse('[{"name":"a<b","price":1050,"tags":["x","y&z"],"age":30},{"name":"c","price":99,"tags":[],"age":41},{"name":"\\"d\\"","price":7,"tags":["t"],"age":5}]');
const esc = s => s.replace(/[&<>"]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
function row(r) { return `<tr><td class="name">${esc(r.name.toUpperCase())}</td><td class="price">${(r.price / 100).toFixed(2)}</td><td class="tags">${esc(r.tags.join(', '))}</td><td class="age">${r.age}</td></tr>`; }
function table(t) { let html = '<table>'; for (let i = 0; i < 5; i++) html += row(rows[(t + i) % rows.length]); return html + '</table>'; }
function weigh(box, i) { const held = box.list; const at = held[i]; return typeof at === 'number' ? at * 2 + box.add : String(at).length + box.add; }
function light(box) { let s = 0; for (let i = 0; i < 3; i++) s += weigh(box, i); return s; }
const said = [];
for (let t = 0; t < 4; t++) said.push(sums(t), table(t).length, table(t).slice(7, 60), light({ list: [t, 'two', 3.5], add: t }));
console.log(said.join('\n'));

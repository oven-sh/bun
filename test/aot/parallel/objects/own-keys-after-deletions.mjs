// A name is deleted off a literal that the code beside it has made: the keys that are left are known, and keep their order.
// STATISTIC: OwnKeysListedAfterDeletions >= 4
// STATISTIC: FreshObjectDeletesTracked >= 6
const turns = JSON.parse("40");
let hash = 0;
const first = [];
function say(...all) { const text = all.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join("|"); for (const c of text) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0; if (first.length < 17) first.push(text); }
function constants() { const o = { ca: 1, cb: 2, cc: 3 }; delete o.cb; return Object.keys(o).length; }
function middle(i) { const o = { ma: i, mb: 2, mc: 3 }; delete o.mb; return [Object.keys(o).length, Object.keys(o), Object.values(o), Object.entries(o)]; }
function everything(i) { const o = { ea: i, eb: 2 }; delete o.ea; delete o.eb; return [Object.keys(o).length, { ...o }, "ea" in o]; }
function again(i) { const o = { ga: i, gb: 2, gc: 3 }; delete o.ga; o.ga = 4; return [Object.keys(o), { ...o }]; }
function longer(i) { const o = { la: i, lb: 2 }; o.le = 5; delete o.la; return [Object.keys(o), { z: 0, ...o }]; }
function sometimes(i) { const o = { sa: i, sb: 2, sc: 3 }; if (i % 2) delete o.sb; return [Object.keys(o), { ...o }]; }
function either(i) { const o = { ia: i, ib: 2, ic: 3 }; if (i % 2) delete o.ia; else delete o.ic; return [Object.keys(o), Object.values(o)]; }
function loops(i) { const o = { ta: i, tb: 2, tc: 3 }; for (let j = 0; j < i % 4; j++) { delete o.tb; if (j === 1) o.tb = j; } return [Object.keys(o), { ...o }]; }
function twice(i) { const o = { wa: i, wb: 2, wc: 3 }; delete o.wb; delete o.wb; delete o.wa; return [Object.keys(o), Object.entries(o)]; }
function walked(i) { const o = { fa: i, fb: 2, fc: 3 }; delete o.fa; let names = ""; for (const name in o) { names += name; if (name === "fb") delete o.fc; } return [names, Object.keys(o)]; }
function copied(i) { const o = { pa: i, pb: { deep: i }, pc: undefined }; delete o.pa; const copy = { ...o, px: 1 }; delete copy.pb; return [Object.keys(copy), copy.pc, o]; }
function assigned(i) { const o = { aa: i, ab: 2 }; delete o.aa; Object.assign(o, { ab: 7, aa: 8 }); return [Object.keys(o), o]; }
function rest(i) { const { rb: taken, ...left } = { ra: i, rb: 2, rc: 3 }; delete left.ra; return [Object.keys(left), taken, left]; }
function escaped(i, held) { const o = { xa: i, xb: 2, xc: 3 }; held.push(o); delete o.xb; return [Object.keys(o).join() + held.length, held[held.length - 1]]; }
function frozen(i) { const o = { za: i, zb: 2 }; delete o.za; Object.freeze(o); return [Object.keys(o), Object.isFrozen(o)]; }
function numbered(i) { const o = { 2: i, na: 1, 1: 2, nb: 3 }; delete o.na; return [Object.keys(o)]; }
const held = [];
let sum = 0;
for (let i = 0; i < turns; i++) {
  for (const f of [constants, middle, everything, again, longer, sometimes, either, loops, twice, walked, copied, assigned, rest, frozen, numbered]) say(f.name, f(i));
  say(escaped(i, held));
  const o = { ya: 1, yb: 2, yc: 3 }; delete o.yb; sum += Object.keys(o).length;
}
console.log(hash, sum, first.join("\n"));

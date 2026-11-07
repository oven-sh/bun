function looks(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.lid + work; }
function chain(n) {
  let last = { lid: 0, next: null };
  for (let i = 1; i < n; i++) { const link = { lid: i, next: last }; if (i & 1) last = link; else last = { lid: -i, next: link }; }
  let sum = 0;
  for (let at = last; at; at = at.next) sum += looks(at);
  return sum;
}
function pick(i) {
  const a = { lid: i, rim: 1 }, b = { lid: i + 1, rim: 2 };
  const c = i & 1 ? a : b;
  let n = 0;
  while (n < 3) { if (looks(c) > 4) break; n++; }
  return n + c.rim + (i & 2 ? a.lid : b.lid);
}
function lists(i) {
  const list = [i, i + 1];
  let out = [];
  for (const each of list) { const pair = [each, each * 2]; if (each & 1) out.push(pair); else out = [pair]; }
  return out.length + out[0][1];
}
function rest(...all) { let n = 0; for (let i = 0; i < all.length; i++) { if (all[i] & 1) n += all[i]; else n -= 1; } return n; }
function handsBack(...all) { if (all.length > 2) return all; return [all.length]; }
function drive() { let sum = 0; for (let t = 0; t < 12; t++) sum += chain(t) + pick(t) + lists(t) + rest(t, t + 1, t + 2) + handsBack(t, t, t)[2] + handsBack(t)[0]; return sum; }
console.log(drive());

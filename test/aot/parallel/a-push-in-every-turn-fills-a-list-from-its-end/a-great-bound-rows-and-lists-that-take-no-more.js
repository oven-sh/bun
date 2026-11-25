function great(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i & 255); let s = 0; for (let i = 0; i < a.length; i += 997) s += a[i]; return a.length + ":" + s; }
function rows(n, w) { const m = n | 0, k = w | 0, kept = []; for (let r = 0; r < m; r++) { const row = []; for (let i = 0; i < k; i++) row.push(i & 15); kept.push(row); } let s = 0; for (const row of kept) s += row.length + row[row.length - 1]; return s; }
function fill(a, m) { for (let i = 0; i < m; i++) a.push(i & 3); }
function frozen(n) { const m = n | 0, a = []; Object.freeze(a); try { fill(a, m); } catch (e) { return e.constructor.name + ":" + a.length; } return a.length; }
function takesNoMore(n) { const m = n | 0, a = []; Object.preventExtensions(a); try { for (let i = 0; i < m; i++) a.push(i & 3); } catch (e) { return e.constructor.name + ":" + a.length; } return a.length; }
const kept = [];
function leaves(n) { const m = n | 0, a = []; kept.push(a); for (let i = 0; i < m; i++) a.push(i & 3); return kept[kept.length - 1].length; }
function named(n) { const m = n | 0, a = []; a.mark = "m"; for (let i = 0; i < m; i++) a.push(i & 3); return a.length + a.mark; }
console.log(great(300000), great(70000), rows(2000, 33), rows(500, 130), rows(3, 1), [0, 1, 6, 40].map(n => [frozen(n), takesNoMore(n), leaves(n), named(n)].join()).join(" "));

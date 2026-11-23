function pushedAndPopped(n) { const m = n | 0, a = []; a.push(4); a.pop(); for (let i = 0; i < m; i++) a[i] = i & 3; return a.length + ":" + a[m - 1]; }
function madeLonger(n) { const m = n | 0, a = []; a.length = 3; for (let i = 0; i < m; i++) a[i] = i & 3; return a.length + ":" + (2 in a) + ":" + a[0]; }
function named(n) { const m = n | 0, a = []; a.mark = "m"; for (let i = 0; i < m; i++) a[i] = i & 3; return a.length + ":" + a.mark + ":" + a[m - 1]; }
function fill(a, m) { for (let i = 0; i < m; i++) a[i] = i & 3; }
function frozen(n) { const m = n | 0, a = []; Object.freeze(a); try { fill(a, m); } catch (e) { return e.constructor.name + ":" + a.length; } return a.length; }
function takesNoMore(n) { const m = n | 0, a = []; Object.preventExtensions(a); try { fill(a, m); } catch (e) { return e.constructor.name + ":" + a.length; } return a.length; }
const kept = [];
function leaves(n) { const m = n | 0, a = []; kept.push(a); for (let i = 0; i < m; i++) a[i] = i & 3; return kept[kept.length - 1].length; }
const said = [];
for (const n of [0, 1, 2, 6, 40, 100]) said.push(pushedAndPopped(n), madeLonger(n), named(n), frozen(n), takesNoMore(n), leaves(n));
console.log(said.join(" "));

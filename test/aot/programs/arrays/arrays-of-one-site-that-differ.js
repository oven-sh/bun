// One function makes all the arrays of a case, so they come from one place in the program. Some of them get a hole, by a door that reaches only them, and the others do not.
// The code that reads an array stands in the case itself, once for each array, so that what is known about one array is used where only that array arrives.
const lines = [];
function run(name, f) { try { lines.push(name + " => " + f().join("  &  ")); } catch (error) { lines.push(name + " => threw " + error.name); } }
function make(n) { const r = []; for (let i = 0; i < n; i++) r.push(i + 1); return r; }
function makeTexts(n) { const r = []; for (let i = 0; i < n; i++) r.push("t" + i); return r; }
function literal() { return [1, 2, 3, 4]; }
function pokeAt(list, index) { list[index] = 7; }
function lengthen(list) { list.length = list.length + 2; }
function remove(list, index) { delete list[index]; }
function pick(flag, x, y) { return flag ? x : y; }
const yes = Date.now() > 0, no = !yes;
function f0() {
  const out = [];
  const a = make(4), b = make(4); b[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('store above the length of the second', f0);
function f1() {
  const out = [];
  const a = make(4), b = make(4); a[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('store above the length of the first', f1);
function f2() {
  const out = [];
  const a = make(4), b = make(4); pokeAt(b, 6);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('in a callee', f2);
function f3() {
  const out = [];
  const a = make(4), b = make(4); pokeAt(a, 1); pokeAt(b, 6);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('in a callee, both, one inside', f3);
function f4() {
  const out = [];
  const a = make(4), b = make(4); lengthen(b);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('length of one', f4);
function f5() {
  const out = [];
  const a = make(4), b = make(4); remove(a, 1);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('delete in one', f5);
function f6() {
  const out = [];
  const a = make(4), b = make(4); pick(yes, a, b)[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('picked at run time, first', f6);
function f7() {
  const out = [];
  const a = make(4), b = make(4); pick(no, a, b)[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('picked at run time, second', f7);
function f8() {
  const out = [];
  const a = make(4), b = make(4); const h = { x: a, y: b }; h.y[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a holder', f8);
function f9() {
  const out = [];
  const a = make(4), b = make(4); const h = { x: a, y: b }; if (yes) { const t = h.x; h.x = h.y; h.y = t; } h.y[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a holder whose fields are swapped', f9);
function f10() {
  const out = [];
  const a = make(4), b = make(4); const all = [a, b]; all[1][6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a list of lists', f10);
function f11() {
  const out = [];
  const a = make(4), b = make(4); const all = [a, b]; all[yes ? 0 : 1][6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a list of lists, index at run time', f11);
function f12() {
  const out = [];
  const all = []; for (let k = 0; k < 3; k++) all.push(make(3)); all[1][5] = 7; const a = all[0], b = all[1], c = all[2];
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  { let s = "";
    for (let i = 0; i < c.length; i++) s += (i in c ? "" : "hole ") + c[i] + ",";
    s += "|"; for (const v of c) s += v + ",";
    let total = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = c;
    out.push(c.length + ":" + s + "|" + total + "|" + c.includes(undefined) + "|" + first + second + third + "|" + [...c].length + "|" + c.at(-1) + "|" + c.join("-")); }
  return out;
}
run('made in a loop, one poked', f12);
function f13() {
  const out = [];
  let last; const all = []; for (let k = 0; k < 3; k++) { last = make(3); all.push(last); } last[5] = 7; const a = all[0], b = all[2];
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('made in a loop, the last poked', f13);
function f14() {
  const out = [];
  const a = make(4), b = make(4); const poke = () => { b[6] = 7; }; poke();
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a closure', f14);
function f15() {
  const out = [];
  const a = make(4), b = make(4); const poker = list => () => { list[6] = 7; }; const p = poker(a), q = poker(b); q();
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a closure made for each', f15);
function f16() {
  const out = [];
  const a = make(4), b = make(4); const poker = list => () => { list[6] = 7; }; const p = poker(a), q = poker(b); (yes ? p : q)();
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a closure made for each, chosen at run time', f16);
function f17() {
  const out = [];
  const a = make(4), b = make(4); pokeAt.bind(null, b, 6)();
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through bind', f17);
function f18() {
  const out = [];
  const a = make(4), b = make(4), c = make(4); pokeAt.call(null, b, 6); pokeAt.apply(null, [c, 7]);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  { let s = "";
    for (let i = 0; i < c.length; i++) s += (i in c ? "" : "hole ") + c[i] + ",";
    s += "|"; for (const v of c) s += v + ",";
    let total = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = c;
    out.push(c.length + ":" + s + "|" + total + "|" + c.includes(undefined) + "|" + first + second + third + "|" + [...c].length + "|" + c.at(-1) + "|" + c.join("-")); }
  return out;
}
run('through call and apply', f18);
function f19() {
  const out = [];
  const a = make(4), b = make(4); const m = new Map([["a", a], ["b", b]]); m.get("b")[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through a Map', f19);
function f20() {
  const out = [];
  const a = make(4), b = make(4); Reflect.set(b, 6, 7);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through Reflect.set', f20);
function f21() {
  const out = [];
  const a = make(4), b = make(4); Object.defineProperty(b, 6, { value: 9, writable: true, enumerable: true, configurable: true });
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('through defineProperty', f21);
function f22() {
  const out = [];
  const x = make(4), y = make(4); y[6] = 7; const a = x.slice(), b = y.slice(), c = x.concat(x), d = x.concat(y);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  { let s = "";
    for (let i = 0; i < c.length; i++) s += (i in c ? "" : "hole ") + c[i] + ",";
    s += "|"; for (const v of c) s += v + ",";
    let total = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = c;
    out.push(c.length + ":" + s + "|" + total + "|" + c.includes(undefined) + "|" + first + second + third + "|" + [...c].length + "|" + c.at(-1) + "|" + c.join("-")); }
  { let s = "";
    for (let i = 0; i < d.length; i++) s += (i in d ? "" : "hole ") + d[i] + ",";
    s += "|"; for (const v of d) s += v + ",";
    let total = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = d;
    out.push(d.length + ":" + s + "|" + total + "|" + d.includes(undefined) + "|" + first + second + third + "|" + [...d].length + "|" + d.at(-1) + "|" + d.join("-")); }
  return out;
}
run('copies', f22);
function f23() {
  const out = [];
  const a = makeTexts(4), b = makeTexts(4); b[6] = "x";
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('texts', f23);
function f24() {
  const out = [];
  const a = literal(), b = literal(); b[6] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('literals', f24);
function f25() {
  const out = [];
  const a = literal(), b = literal(); delete a[0];
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('literals, delete', f25);
function f26() {
  const out = [];
  const one = () => make(3), two = () => make(3); const a = one(), b = two(); b[5] = 7; const c = one(), d = two();
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  { let s = "";
    for (let i = 0; i < c.length; i++) s += (i in c ? "" : "hole ") + c[i] + ",";
    s += "|"; for (const v of c) s += v + ",";
    let total = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = c;
    out.push(c.length + ":" + s + "|" + total + "|" + c.includes(undefined) + "|" + first + second + third + "|" + [...c].length + "|" + c.at(-1) + "|" + c.join("-")); }
  { let s = "";
    for (let i = 0; i < d.length; i++) s += (i in d ? "" : "hole ") + d[i] + ",";
    s += "|"; for (const v of d) s += v + ",";
    let total = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = d;
    out.push(d.length + ":" + s + "|" + total + "|" + d.includes(undefined) + "|" + first + second + third + "|" + [...d].length + "|" + d.at(-1) + "|" + d.join("-")); }
  return out;
}
run('two makers that share a maker', f26);
function f27() {
  const out = [];
  function deep(n) { const r = make(3); if (n) { const inner = deep(n - 1); if (n === 2) inner[0][5] = 7; return [r, ...inner]; } return [r]; } const all = deep(3); const a = all[0], b = all[1], c = all[2], d = all[3];
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  { let s = "";
    for (let i = 0; i < c.length; i++) s += (i in c ? "" : "hole ") + c[i] + ",";
    s += "|"; for (const v of c) s += v + ",";
    let total = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = c;
    out.push(c.length + ":" + s + "|" + total + "|" + c.includes(undefined) + "|" + first + second + third + "|" + [...c].length + "|" + c.at(-1) + "|" + c.join("-")); }
  { let s = "";
    for (let i = 0; i < d.length; i++) s += (i in d ? "" : "hole ") + d[i] + ",";
    s += "|"; for (const v of d) s += v + ",";
    let total = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = d;
    out.push(d.length + ":" + s + "|" + total + "|" + d.includes(undefined) + "|" + first + second + third + "|" + [...d].length + "|" + d.at(-1) + "|" + d.join("-")); }
  return out;
}
run('recursion', f27);
function f28() {
  const out = [];
  const a = make(4), b = make(4); const k = 3; if (k < b.length) { b.length = 1; b[k] = 7; } if (k < a.length) a[k] = 7;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('shortened, then stored below the old length', f28);
function f29() {
  const out = [];
  const a = make(4), b = make(4); new Function("list", "list[" + (yes ? 6 : 0) + "] = 7")(b);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('one escapes to evaluated text', f29);
function f30() {
  const out = [];
  globalThis.keptA = make(4); globalThis.keptB = make(4); globalThis.keptB[6] = 7; const a = globalThis.keptA, b = globalThis.keptB;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('kept in globals', f30);
function f31() {
  const out = [];
  const a = make(4), b = make(4); let early = 0; for (let i = 0; i < b.length; i++) early += b[i]; b[6] = early;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('poked after it was read', f31);
function f32() {
  const out = [];
  let v = make(4); const a = v; v = make(4); v[6] = 7; const b = v;
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('same variable holds one, then the other', f32);
function f33() {
  const out = [];
  const a = make(4), b = make(4); function maybe(list, flag) { if (flag) list[6] = 7; } maybe(a, no); maybe(b, yes);
  { let s = "";
    for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
    s += "|"; for (const v of a) s += v + ",";
    let total = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = a;
    out.push(a.length + ":" + s + "|" + total + "|" + a.includes(undefined) + "|" + first + second + third + "|" + [...a].length + "|" + a.at(-1) + "|" + a.join("-")); }
  { let s = "";
    for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
    s += "|"; for (const v of b) s += v + ",";
    let total = 0; for (let i = 0; i < b.length; i++) { const v = b[i]; total += v === undefined ? 1000 : typeof v === "number" ? v : 1; }
    const [first, second, third] = b;
    out.push(b.length + ":" + s + "|" + total + "|" + b.includes(undefined) + "|" + first + second + third + "|" + [...b].length + "|" + b.at(-1) + "|" + b.join("-")); }
  return out;
}
run('parameter of a function called with each', f33);
console.log(lines.join("\n"));

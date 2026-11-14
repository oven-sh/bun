// at() in loops over lists that nothing outside sees, with holes, elements deleted, lengths made longer.
function literal(n) { const list = [1, , 3]; let s = ""; for (let i = 0; i < n; i++) s += String(list.at(i)) + ","; return s; }
function removed(n) { const list = [1, 2, 3]; delete list[1]; let s = 0; for (let i = 0; i < n; i++) { const v = list.at(i); s = s * 10 + (v === undefined ? 7 : v); } return s; }
function longer(n) { const list = [1, 2, 3]; list.length = 6; let s = 0; for (let i = 0; i < n; i++) { const v = list.at(-1); s = s * 10 + (v === undefined ? 7 : v); } return s; }
function doubles(n) { const list = [1.5, 2.5, 3.5]; delete list[2]; let s = 0; for (let i = 0; i < n; i++) { const v = list.at(-1); s = s * 10 + (v === undefined ? 7 : v); } return s; }
function summed(n) { const list = [1, 2, 3]; delete list[0]; let s = 0; for (let i = 0; i < n; i++) s += list.at(i); return s; }
function made(n) { const list = new Array(5); list[0] = 1; list[4] = 2; let s = ""; for (let i = 0; i < n; i++) s += String(list.at(i)) + String(list.at(-2)); return s; }
function objects(n) { const list = [{ x: 1 }, { x: 2 }, { x: 3 }]; delete list[1]; let s = ""; for (let i = 0; i < n; i++) { const p = list.at(i); s += p ? p.x : typeof p; } return s; }
function texts(n) { const list = ["a", "b", "c"]; list.length = 5; let s = ""; for (let i = 0; i < n; i++) s += list.at(i) + "|" + typeof list.at(-1); return s; }
function grows(n) { const list = [1]; let s = 0; for (let i = 0; i < n; i++) { s += list.at(-1); list[list.length + 1] = i; s += list.at(-2) === undefined ? 100 : 0; } return s; }
function pops(n) { const list = [1, 2, 3]; let s = ""; for (let i = 0; i < n; i++) { s += String(list.at(-1)); list.pop(); } return s; }
function once() { const list = [1, , 3]; return typeof list.at(1) + typeof list.at(-2) + typeof list.at(5); }
function half(n) { const list = [1, 2, 3]; if (n > 3) delete list[2]; let s = 0; for (let i = 0; i < n; i++) s = (s + list.at(-1)) | 0; return s; }
for (const run of [literal, removed, longer, doubles, summed, made, objects, texts, grows, pops, once, half]) for (const n of [0, 3, 6]) { let a; try { a = run(n); } catch (e) { a = e.constructor.name; } console.log(run.name, n, String(a)); }

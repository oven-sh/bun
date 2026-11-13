// Rows read under constants in a loop that moves the elements of a list: the list may be the holder of the rows, one of its rows, or neither. Without the check of what the loop stores into, the build stops under proof-checks.
'use strict';
function made(k) { const g = []; for (let a = 0; a < 4; a++) { g[a] = []; for (let b = 0; b < 4; b++) g[a][b] = a * 4 + b + k; } return g; }
function show(v) { if (!Array.isArray(v)) return Object.is(v, -0) ? "-0" : String(v); let s = "["; for (let i = 0; i < v.length; i++) s += (i in v ? Array.isArray(v[i]) ? "[" + Array.from(v[i], (x, j) => j in v[i] ? Array.isArray(x) ? "list" : String(x) : "hole").join(" ") + "]" : String(v[i]) : "hole") + " "; return s + "]"; }
function f(s, o, p, x, other, q, m, n, at) { let t = 0; for (let i = 0; i < n; i++) { t = t ^ s[0][0]; o[1] = o[0]; t = t + s[2][i & 1] | 0; s[0][i] ^= 3; for (let j = 0; j < 4; j++) o[j & 1] = s[0]; } return t; }
function run(name, make) { for (let k = 0; k < 5; k++) { const [s, o, p, u, z] = make(k); let told; try { told = f(s, o, p, k, u[2], u[0], k % 3, 4, k); } catch (e) { told = e.constructor.name; } console.log(name, k, told, show(s), show(u), show(z)); } }
run("u u", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: s }; return [s, u, u, u, z]; });
run("s u", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: u }; return [s, s, u, u, z]; });
run("u s", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: u }; return [s, u, s, u, z]; });
run("u s[1]", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: u }; return [s, u, s[1], u, z]; });
run("u u", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: u }; return [s, u, u, u, z]; });
run("s[0] s", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: s }; return [s, s[0], s, u, z]; });
run("box.held u", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: s }; return [s, box.held, u, u, z]; });
run("u u", k => { const s = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [1.5, 2, 3, 4]], u = made(k + 3), z = [1, 2, 3, 4], box = { held: s }; return [s, u, u, u, z]; });

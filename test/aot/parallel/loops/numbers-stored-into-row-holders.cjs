// Numbers stored, in some iterations, into the list that holds the rows the loop reads: the preheader compares the two.
function made(k) { const g = []; for (let a = 0; a < 4; a++) { g[a] = []; for (let b = 0; b < 4; b++) g[a][b] = a * 4 + b + k; } return g; }
function show(v) { return v.map(x => Array.isArray(x) ? "[" + x.map(y => Array.isArray(y) ? "list" : String(y)).join(" ") + "]" : String(x)).join(" "); }
function f(s, o, q, x, m, n, at, lim) { let t = 0; for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) { t = t + s[1][i] | 0; s[0][0] = t; if (t > lim) o[i] = t; t = t + s[0][i & 3] | 0; } return t; }
function run(name, make) { for (let k = 0; k < 5; k++) { const [s, o, z] = make(k); let told; try { told = f(s, o, z, k, k % 2, 4, k % 4, 30); } catch (e) { told = e.constructor.name; } console.log(name, k, told, show(s), show(o), show(z)); } }
run("s", k => { const s = made(k), u = made(k + 2), z = [1, 2, 3, 4], y = [1.5, 2, 3, 4]; return [s, s, z]; });
run("u", k => { const s = made(k), u = made(k + 2), z = [1, 2, 3, 4], y = [1.5, 2, 3, 4]; return [s, u, z]; });
run("s", k => { const s = made(k), u = made(k + 2), z = [1, 2, 3, 4], y = [1.5, 2, 3, 4]; return [s, s, z]; });

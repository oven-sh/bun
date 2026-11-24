const lines = [], told = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const a0 = Object.freeze([1, 2, 3]);
const a1 = { out: [0, , 2], name: 'r' };
const a2 = []; for (let i = 0; i < 4; i++) a2.push(i);
const src = ['a', 'b', 'c', 'd'], src2 = [0.5, 1.5, 2, 3], src3 = [0, 1, 0, 2];
function f0(turns, l) { let n = 0; for (let k = 0; k < turns; k++) { const v = src[k & 3]; if (k & 1) a0[k] = v + 1; } return n; }
function f3(turns, l) { let n = 0; for (let k = 0; k < turns; k++) { const v = l[k % (l.length || 1)]; if (v) { a1.out[n & 1] += k & 3; } else { a0[1] = k; } if (v) a2[n & 1] = v + 1; a0[k % 5]++; n++; } return n; }
const b0 = [1, 2, 3, 4, 5], b1 = { out: [0, 1, 2], name: 's' }, b2 = [0, 0, 0, 0];
function g3(turns, l) { let n = 0; for (let k = 0; k < turns; k++) { const v = l[k % (l.length || 1)]; if (v) { b1.out[n & 1] += k & 3; } else { b0[1] = k; } if (v) b2[n & 1] = v + 1; b0[k % 5]++; n++; } return n; }
function g4(turns, l) { let n = 0; for (let k = 0; k < turns; k++) { const v = l[k & 3], i = n & 1; if (v) { b1.out[i] += k & 3; } else { b0[1] = k; } if (v) b2[i] = v + 1; b0[k % 5]++; n++; } return n; }
function run(f, turns) { let last = ''; for (let c = 0; c < 6; c++) last = told(() => f(turns, [src, src2, src3][c % 3])); return last; }
const state = () => JSON.stringify([a0, a1, a2, b0, b1, b2]);
for (let t = 0; t < 2; t++) { lines.push('f0', run(f0, 60), run(f0, 5), state()); lines.push('f3', run(f3, 60), run(f3, 5), state()); lines.push('g3', run(g3, 60), run(g3, 5), state()); lines.push('g4', run(g4, 60), run(g4, 5), state()); }
b1.out = [0.5, 1, 'x']; lines.push(run(g3, 60), run(g4, 60), state());
Object.freeze(b2); lines.push(run(g3, 60), run(g4, 60), state());
b1.out = undefined; lines.push(run(g3, 60), run(g4, 60), state());
console.log(lines.join('\n'));

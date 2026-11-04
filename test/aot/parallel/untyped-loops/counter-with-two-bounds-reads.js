// As counter-with-two-bounds.js, with the elements read in the loop: the compiler aborted.
function f(list, o) { const n = o.n; let i = 0, t = 0; while (i + 1 <= n) { if (i >= list.length) break; t += list[i]; i = i + 1; } return [i, t]; }
console.log(f([7, 8, 9], { n: 3 }));
console.log(f([7, 8, 9], { n: 2147483656 }));

const n = Number(process.env.NO_SUCH ?? -4);
function f(l, n) { for (let i = n | 0; i < 0; i++) { const k = i % 4, j = k; l[j] = k; } return l; }
console.log(Object.is(f([1, 2, 3, 4], n)[0], -0));
export {};

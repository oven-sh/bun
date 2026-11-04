function f(a) { let s = 0; let i = -1; while (++i < a.length) { if (a[i] !== 100) { a[i] = undefined; if (a[i] === 3) a[i] = 1.25; } s = s + a[i] * 2; } return s; }
const list = new Uint8Array([1, 100, 3]); console.log(f(list), String(list));

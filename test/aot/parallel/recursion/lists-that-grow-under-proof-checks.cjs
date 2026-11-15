// Flags: --aot-harden=proof-checks
// A list of numbers that a function calling itself reads and grows: its elements are taken as bits, so a hole is read as NaN, and what is held against memory does not tell that from undefined.
function f(a, i, n) { if (n < 0) return 0; let s = a[i & 3] | 0; a[a.length + 2] = 1; return s + f(a, i + 1, n - 1) + f(a, i + 2, n - 2); }
console.log(f(Array.from({ length: 0 }, (_, i) => i + 0.5), 1, 3));

// Two fresh objects change names on every turn.
function swapped(n) { const a = { n: 0 }, b = { n: 100 }; let p = a, q = b; for (let i = 0; i < n; i++) { p.n += i; const t = p; p = q; q = t; } return a.n + ":" + b.n; }
function swappedByPattern(n) { const a = { n: 0 }, b = { n: 100 }; let p = a, q = b; for (let i = 0; i < n; i++) { p.n += i; [p, q] = [q, p]; } return a.n + ":" + b.n; }
function rotated(n) { const a = { n: 0 }, b = { n: 10 }, c = { n: 20 }; let p = a, q = b, r = c; for (let i = 0; i < n; i++) { p.n += i; const t = p; p = q; q = r; r = t; } return a.n + ":" + b.n + ":" + c.n; }
function madeInTurn(n) { let k = { n: 0 }; const first = k; let sum = 0; for (let i = 0; i < n; i++) { k.n += i; sum += k.n; const next = { n: i }; k = next; next.n += 1; } return first.n + ":" + k.n + ":" + sum; }
console.log(swapped(0), swapped(1), swapped(6), swappedByPattern(6), rotated(7), madeInTurn(0), madeInTurn(5));
let last = ""; for (let r = 0; r < 300; r++) last = [swapped(6), swappedByPattern(6), rotated(7), madeInTurn(5)].join(" ");
console.log(last);

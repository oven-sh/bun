// A loop fills a list up to a constant bound and reads and stores it by other keys and names meanwhile: what is kept of its storage ends where the list grows.
function first(l) { let s = 0; for (let i = 0; i < 0x4000; i++) { l[i] = i; l[0] += 1; s += l[0]; } return [s, l[0], l.length, l[100], l[0x3fff]]; }
function alias(l, m) { let s = 0; for (let i = 0; i < 5000; i++) { const before = m[i >> 1]; l[i] = i * 2; m[i >> 2] = i; s += (before | 0) + l[i] + m[i >> 2]; } return [s, l.length, l[3], m[4999]]; }
function fields(o) { let s = 0; for (let i = 0; i <= 0x1fff; i++) { const list = o.list, last = i > 0 ? list[i - 1] : 0; if (i < 0x1000) o.list[i] = i + 1; else o.list[i] = last + 0.5; list[i >> 3] = last; s += list[i >> 3] + o.list[i]; } return [s, o.list.length, o.list[7], o.list[0x1fff]]; }
function two(a, b) { let s = 0; for (let i = 0; i < 3000; i++) { a[i] = b[i] = i; a[i >> 1] += b[i >> 1]; s += a[i >> 1]; } return [s, a.length, b.length, a[10], b[2999]]; }
console.log(first([]).join(), first([]).join(), first([5]).join(), first([0.5]).join(), first(["t"]).join());
for (const make of [() => [], () => [1], () => [0.25], () => ["s"], () => new Array(7), () => [, 1]]) { const l = make(); console.log(alias(l, l).join(), alias(make(), make()).join(), fields({ list: make() }).join(), two(l, make()).join()); const m = make(); console.log(two(m, m).join()); }
let total = 0; for (let round = 0; round < 40; round++) { const l = []; total += first(l)[0] % 1009 + alias(l, l)[0] % 1013 + fields({ list: round % 2 ? l : [] })[0] % 1019; } console.log(total);

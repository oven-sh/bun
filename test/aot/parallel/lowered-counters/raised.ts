// Loops that raise the counter that they lower: above the length nothing is there.
function views(a: Uint8Array): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { r += a[k] === undefined ? 1000 : a[k]!; if (n++ === 2) k = a.length + 3; } return r; }
function sums(a: Uint8Array): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { r = (r * 3 + a[k]!) | 0; if (n++ === 2) k += 9; } return r; }
function lists(a: number[]): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { r += a[k] ?? 1000; if (n++ === 2) k += 9; } return r; }
function doubles(a: Float64Array): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { r += a[k]!; if (n++ === 2) k += 9; } return r; }
function texts(s: string): number { let r = 0, n = 0; for (let k = s.length - 1; k >= 0; k--) { const c = s.charCodeAt(k); r += c !== c ? 1000 : c; if (n++ === 2) k += 9; } return r; }
function stores(a: Uint8Array): string { let n = 0; for (let k = a.length - 1; k >= 0; k--) { a[k] = k; if (n++ === 2) k += 9; } return a.join(); }
const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
console.log(views(bytes), sums(bytes), lists([1, 2, 3, 4, 5, 6]), doubles(Float64Array.from(bytes)), texts("abcdef" + bytes[0]), stores(new Uint8Array(6)));

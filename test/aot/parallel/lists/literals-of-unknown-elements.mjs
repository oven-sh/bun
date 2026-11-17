// Literals of unknown elements that a loop fills.
// STATISTIC: StoresGrowingArrays >= 8
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 2 ? "..." : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length + (x.length > 9 ? show(x[x.length - 1], 2) + x.reduce((a, b) => typeof b === "number" ? a + b : a + 1, 0) : "") + Object.keys(x).length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
function decay(x, n, v, w) { const a = [v]; for (let i = 1; i < n; i++) a[i] = a[i - 1] * 0.9 + 1; return show([a, a.length]); }
function sums(x, n, v, w) { const a = [v]; for (let i = 1; i < n; i++) a[i] = a[i - 1] + w; return show([a, a.length]); }
function pair(x, n, v, w) { const a = [v, w]; for (let i = 2; i < n; i++) a[i] = a[i - 1] + a[i - 2]; return show([a, a.length]); }
function counts(x, n, v, w) { const a = [v]; for (let i = 1; i < n; i++) a[i] = i * 2; return show([a, a.length]); }
function halves(x, n, v, w) { const a = [v, 1]; for (let i = 2; i < n; i++) a[i] = i * 0.5; return show([a, a.length]); }
function from(x, n, v, w) { const a = [x[0]]; for (let i = 1; i < x.length; i++) a[i] = x[i] - a[i - 1]; return show([a, a.length]); }
function moves(x, n, v, w) { const a = [x[0]]; for (let i = 1; i < x.length; i++) a[i] = x[i]; return show([a, a.length]); }
function over(x, n, v, w) { const a = [v, w, 3]; for (let i = 0; i < n; i++) a[i] = i + 0.5; return show([a, a.length]); }
function some(x, n, v, w) { const a = [v]; for (let i = 0; i < n; i++) if (i & 1) a[i] = i * 3; return show([a, a.length, 0 in a, 2 in a]); }
function nest(x, n, v, w) { let s = ""; for (let k = 0; k < 3; k++) { const a = [v, k]; for (let i = 2; i < n; i++) a[i] = a[i - 1] + k; s += show(a); } return s; }
function after(x, n, v, w) { const a = [v]; let t = 0; for (let i = 1; i < n; i++) { a[i] = a[i - 1] + 1; t += a.length; } a.push(w); return show([a, t]); }
function caught(x, n, v, w) { const a = [v]; try { for (let i = 1; i < n; i++) { a[i] = a[i - 1] + 1; if (i === 3) throw 1; } } catch { a[0] = w; } return show(a); }
function whole(x, n, v, w) { const a = [v | 0]; for (let i = 1; i < n; i++) a[i] = (a[i - 1] + 7) | 0; return show(a); }
function texts(x, n, v, w) { const a = [v]; for (let i = 1; i < n; i++) a[i] = a[i - 1] + "t"; return show(a); }
function asked(x, n, v, w) { const a = [v]; const b = a; for (let i = 1; i < n; i++) { a[i] = b[i - 1] + 1; b[0] = w; } return show([a, a === b]); }
function down(x, n, v, w) { const a = [v, w]; for (let i = n - 1; i > 0; i--) a[i] = i + 0.25; return show(a); }
const values = [() => 3, () => 0.5, () => -0, () => NaN, () => 2147483647, () => "t", () => undefined, () => null, () => true, () => ({ valueOf() { calls++; return 2; } }), () => 5n, () => Symbol.iterator, () => [1], () => 1e300];
const lists = [[1, 2, 3, 4], [0.5, 1.5, 2.5], ["a", "b"], [, 2, 3], [], [null, 1], [NaN, -0, 7]];
const sizes = [0, 1, 2, 3, 9, 60];
const forms = { decay, sums, pair, counts, halves, from, moves, over, some, nest, after, caught, whole, texts, asked, down };
for (const name in forms) for (let v = 0; v < values.length; v++) for (let w = v % 3; w < values.length; w += 3) for (let c = 0; c < sizes.length; c++) {
  calls = 0; let answer; try { answer = forms[name](lists[(v + w + c) % lists.length], sizes[c], values[v](), values[w]()); } catch (e) { answer = e && e.constructor ? e.constructor.name : typeof e; }
  keep(name + " " + v + " " + w + " " + c + " " + answer + calls);
}
console.log(cases, digest); for (const x of said) console.log(x);

// Written-out inner loops that store several times in a turn and fail in the middle; counters that step up in some turns alone.
// STATISTIC: StoresGrowingArrays >= 30
// STATISTIC: StoresUndoneAtIterationRestarts >= 150
// STATISTIC: LoopVersioningAttemptsFailed = 0
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 2 ? "..." : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 8) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
function f2(o, i) { return o.length * i & 7; }
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const inputs = [() => JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]"), () => JSON.parse("[0.5,1.5,2.5,3.5,0.5,1.5,2.5,9.5,4.5]"), () => [1, 2, 3, 4, "t", 6, 7, 8], () => [1.5, 2.5, NaN, 3, 4, 5, 6], () => [1, 2, , 4, 5, 6, 7], () => [3, undefined, 2, null, 1, 5], () => [2147483647, 2147483647, 2, 3, 4], () => [-0, 0, -0, 1, 2], () => new Float64Array([1, 2.5, 3, 0.5, 4, 5]), () => got([1, 2, 3, 4, 5, 6], 4, 2.5), () => [1, 2, 3, { valueOf() { calls++; return 7; } }, 5], () => [1n, 2n, 3n], () => [], () => ["b", "a", "c"], () => [5, 4, 3, 5, 4, 3, 2, 1]];
const targets = [() => [0, 0, 0, 0], () => [0.5, 1, 2, 3, 4], () => [], () => Object.freeze([1, 2, 3, 4]), () => new Float64Array(4), () => new Uint8Array(4), () => got([1, 2, 3, 4], 1, 9), () => ["p", "q"], () => new Array(5)];
function run(name, f) { for (let k = 0; k < inputs.length; k++) for (let t = k % 3; t < targets.length; t += 2) { calls = 0; const x = inputs[k](), given = targets[t](), other = targets[(t + k) % targets.length](); let answer; try { answer = f(x, 2 + (k + t) % 3, [2, 0.5, NaN, "t", -0][(k + t) % 5], given, other, [[1, 2], [0.5, 1.5], given], { get q() { calls++; return 1; } }); } catch (e) { answer = e && e.constructor ? e.constructor.name : typeof e; } keep(name + " " + answer + show(given) + show(other) + show(x) + calls); } }
function r_add_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); }
function r_set_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); }
function r_two_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); }
function* G_reset_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } yield show([a, b, s, x.length]); } const r_reset_0 = (...q) => [...G_reset_0(...q)][0];
function* G_least_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } yield show([a, b, s, x.length]); } const r_least_0 = (...q) => [...G_least_0(...q)][0];
function r_same_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } return show([a, b, s, x.length]); }
function r_rows_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } return show([a, b, s, x.length]); }
function* G_mixed_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } yield show([a, b, s, x.length]); } const r_mixed_0 = (...q) => [...G_mixed_0(...q)][0];
function* G_names_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } yield show([a, b, s, x.length]); } const r_names_0 = (...q) => [...G_names_0(...q)][0];
function* G_calls_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } yield show([a, b, s, x.length]); } const r_calls_0 = (...q) => [...G_calls_0(...q)][0];
class C_filter_0 { m(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); } } const r_filter_0 = (...q) => new C_filter_0().m(...q);
const r_filter2_0 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); })[0];
function r_both_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; return show([a, b, s, x.length]); }
function* G_stack_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; yield show([a, b, s, x.length]); } const r_stack_0 = (...q) => [...G_stack_0(...q)][0];
class C_unique_0 { m(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); } } const r_unique_0 = (...q) => new C_unique_0().m(...q);
function* G_merge_0(x, m, w, given, other, g, h) { const a = [], b = other; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; yield show([a, b, s, x.length]); } const r_merge_0 = (...q) => [...G_merge_0(...q)][0];
const r_compact_0 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); })[0];
function r_add_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); }
function r_set_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); }
function r_two_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); }
class C_reset_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } return show([a, b, s, x.length]); } } const r_reset_1 = (...q) => new C_reset_1().m(...q);
class C_least_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } return show([a, b, s, x.length]); } } const r_least_1 = (...q) => new C_least_1().m(...q);
function* G_same_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } yield show([a, b, s, x.length]); } const r_same_1 = (...q) => [...G_same_1(...q)][0];
function* G_rows_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } yield show([a, b, s, x.length]); } const r_rows_1 = (...q) => [...G_rows_1(...q)][0];
class C_mixed_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } return show([a, b, s, x.length]); } } const r_mixed_1 = (...q) => new C_mixed_1().m(...q);
class C_names_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } return show([a, b, s, x.length]); } } const r_names_1 = (...q) => new C_names_1().m(...q);
class C_calls_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } return show([a, b, s, x.length]); } } const r_calls_1 = (...q) => new C_calls_1().m(...q);
const r_filter_1 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); })[0];
function r_filter2_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); }
function* G_both_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; yield show([a, b, s, x.length]); } const r_both_1 = (...q) => [...G_both_1(...q)][0];
class C_stack_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); } } const r_stack_1 = (...q) => new C_stack_1().m(...q);
const r_unique_1 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); })[0];
class C_merge_1 { m(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; return show([a, b, s, x.length]); } } const r_merge_1 = (...q) => new C_merge_1().m(...q);
function r_compact_1(x, m, w, given, other, g, h) { const a = [0, 0, 0, 0], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); }
function* G_add_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; yield show([a, b, s, x.length]); } const r_add_2 = (...q) => [...G_add_2(...q)][0];
function* G_set_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; yield show([a, b, s, x.length]); } const r_set_2 = (...q) => [...G_set_2(...q)][0];
function* G_two_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } yield show([a, b, s, x.length]); } const r_two_2 = (...q) => [...G_two_2(...q)][0];
const r_reset_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } return show([a, b, s, x.length]); })[0];
const r_least_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } return show([a, b, s, x.length]); })[0];
class C_same_2 { m(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } return show([a, b, s, x.length]); } } const r_same_2 = (...q) => new C_same_2().m(...q);
class C_rows_2 { m(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } return show([a, b, s, x.length]); } } const r_rows_2 = (...q) => new C_rows_2().m(...q);
const r_mixed_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } return show([a, b, s, x.length]); })[0];
const r_names_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } return show([a, b, s, x.length]); })[0];
const r_calls_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } return show([a, b, s, x.length]); })[0];
function r_filter_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); }
function r_filter2_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); }
class C_both_2 { m(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; return show([a, b, s, x.length]); } } const r_both_2 = (...q) => new C_both_2().m(...q);
const r_stack_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); })[0];
function r_unique_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); }
const r_merge_2 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; return show([a, b, s, x.length]); })[0];
function r_compact_2(x, m, w, given, other, g, h) { const a = [0.5, 0.5, 0.5, 0.5], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); }
class C_add_3 { m(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); } } const r_add_3 = (...q) => new C_add_3().m(...q);
class C_set_3 { m(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); } } const r_set_3 = (...q) => new C_set_3().m(...q);
class C_two_3 { m(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); } } const r_two_3 = (...q) => new C_two_3().m(...q);
function r_reset_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } return show([a, b, s, x.length]); }
function r_least_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } return show([a, b, s, x.length]); }
const r_same_3 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } return show([a, b, s, x.length]); })[0];
const r_rows_3 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } return show([a, b, s, x.length]); })[0];
function r_mixed_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } return show([a, b, s, x.length]); }
function r_names_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } return show([a, b, s, x.length]); }
function r_calls_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } return show([a, b, s, x.length]); }
function r_filter_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); }
function* G_filter2_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; yield show([a, b, s, x.length]); } const r_filter2_3 = (...q) => [...G_filter2_3(...q)][0];
const r_both_3 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; return show([a, b, s, x.length]); })[0];
function r_stack_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); }
function r_unique_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); }
function r_merge_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; return show([a, b, s, x.length]); }
function* G_compact_3(x, m, w, given, other, g, h) { const a = [w], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; yield show([a, b, s, x.length]); } const r_compact_3 = (...q) => [...G_compact_3(...q)][0];
const r_add_4 = (x, m, w, given, other, g, h) => [0].map(() => { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); })[0];
const r_set_4 = (x, m, w, given, other, g, h) => [0].map(() => { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); })[0];
const r_two_4 = (x, m, w, given, other, g, h) => [0].map(() => { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); })[0];
function r_reset_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } return show([a, b, s, x.length]); }
function r_least_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } return show([a, b, s, x.length]); }
function r_same_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } return show([a, b, s, x.length]); }
function r_rows_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } return show([a, b, s, x.length]); }
function r_mixed_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } return show([a, b, s, x.length]); }
function r_names_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } return show([a, b, s, x.length]); }
function r_calls_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } return show([a, b, s, x.length]); }
function* G_filter_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; yield show([a, b, s, x.length]); } const r_filter_4 = (...q) => [...G_filter_4(...q)][0];
class C_filter2_4 { m(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); } } const r_filter2_4 = (...q) => new C_filter2_4().m(...q);
function r_both_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; return show([a, b, s, x.length]); }
function r_stack_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); }
function* G_unique_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; yield show([a, b, s, x.length]); } const r_unique_4 = (...q) => [...G_unique_4(...q)][0];
function r_merge_4(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; return show([a, b, s, x.length]); }
class C_compact_4 { m(x, m, w, given, other, g, h) { const a = given, b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); } } const r_compact_4 = (...q) => new C_compact_4().m(...q);
function r_add_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); }
function r_set_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); }
function r_two_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); }
function* G_reset_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } yield show([a, b, s, x.length]); } const r_reset_5 = (...q) => [...G_reset_5(...q)][0];
function* G_least_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } yield show([a, b, s, x.length]); } const r_least_5 = (...q) => [...G_least_5(...q)][0];
function r_same_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } return show([a, b, s, x.length]); }
function r_rows_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } return show([a, b, s, x.length]); }
function* G_mixed_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } yield show([a, b, s, x.length]); } const r_mixed_5 = (...q) => [...G_mixed_5(...q)][0];
function* G_names_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } yield show([a, b, s, x.length]); } const r_names_5 = (...q) => [...G_names_5(...q)][0];
function* G_calls_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } yield show([a, b, s, x.length]); } const r_calls_5 = (...q) => [...G_calls_5(...q)][0];
class C_filter_5 { m(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); } } const r_filter_5 = (...q) => new C_filter_5().m(...q);
const r_filter2_5 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); })[0];
function r_both_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; return show([a, b, s, x.length]); }
function* G_stack_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; yield show([a, b, s, x.length]); } const r_stack_5 = (...q) => [...G_stack_5(...q)][0];
class C_unique_5 { m(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); } } const r_unique_5 = (...q) => new C_unique_5().m(...q);
function* G_merge_5(x, m, w, given, other, g, h) { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; yield show([a, b, s, x.length]); } const r_merge_5 = (...q) => [...G_merge_5(...q)][0];
const r_compact_5 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [1, "t", 3, 4], b = [0, 0, 0]; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); })[0];
function r_add_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) a[i] += x[k * 4 + i]; return show([a, b, s, x.length]); }
function r_set_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) a[i] = x[k + i] * 2; return show([a, b, s, x.length]); }
function r_two_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + w; b[i] = a[i] - 1; } return show([a, b, s, x.length]); }
class C_reset_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) { a[k] = 0; for (let j = 0; j < 3; j++) a[k] += x[j + k]; } return show([a, b, s, x.length]); } } const r_reset_6 = (...q) => new C_reset_6().m(...q);
class C_least_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 1; k < m; k++) { a[k] = 1e9; for (let j = 1; j <= 3 && j <= k; j++) a[k] = Math.min(a[k], a[k - j] + x[j]); } return show([a, b, s, x.length]); } } const r_least_6 = (...q) => new C_least_6().m(...q);
function* G_same_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 4; i++) { a[i & 1] = a[i & 1] * 0.5 + x[k + i]; s += a[0]; } yield show([a, b, s, x.length]); } const r_same_6 = (...q) => [...G_same_6(...q)][0];
function* G_rows_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) { const r = g[k % g.length]; for (let i = 0; i < 2; i++) r[i] = r[i] + x[k + i]; } yield show([a, b, s, x.length]); } const r_rows_6 = (...q) => [...G_rows_6(...q)][0];
class C_mixed_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { if (x[k + i] > 2) a[i] = x[k + i]; else a[i] -= 1; } return show([a, b, s, x.length]); } } const r_mixed_6 = (...q) => new C_mixed_6().m(...q);
class C_names_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i]; s += h.q; } return show([a, b, s, x.length]); } } const r_names_6 = (...q) => new C_names_6().m(...q);
class C_calls_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; for (let k = 0; k < m; k++) for (let i = 0; i < 3; i++) { a[i] = x[k + i] + 1; s += f2(a, i); } return show([a, b, s, x.length]); } } const r_calls_6 = (...q) => new C_calls_6().m(...q);
const r_filter_6 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0, , 0, 0], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] > w) a[n++] = x[k]; s = n; return show([a, b, s, x.length]); })[0];
function r_filter2_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== w) { a[++n] = x[k]; b[n] = k; } s = n; return show([a, b, s, x.length]); }
function* G_both_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; let n = 0, p = 0; for (let k = 0; k < x.length; k++) if (x[k] > 2) a[n++] = x[k]; else b[p++] = x[k] * w; s = n * 100 + p; yield show([a, b, s, x.length]); } const r_both_6 = (...q) => [...G_both_6(...q)][0];
class C_stack_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { while (n > 0 && a[n - 1] > x[k]) n--; a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); } } const r_stack_6 = (...q) => new C_stack_6().m(...q);
const r_unique_6 = (x, m, w, given, other, g, h) => [0].map(() => { const a = [0, , 0, 0], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) { let j = 0; while (j < n && a[j] !== x[k]) j++; if (j === n) a[n++] = x[k]; } s = n; return show([a, b, s, x.length]); })[0];
class C_merge_6 { m(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; let n = 0, i = 0, j = 0; while (i < x.length && j < b.length) a[n++] = x[i] <= b[j] ? x[i++] : b[j++]; while (i < x.length) a[n++] = x[i++]; s = n; return show([a, b, s, x.length]); } } const r_merge_6 = (...q) => new C_merge_6().m(...q);
function r_compact_6(x, m, w, given, other, g, h) { const a = [0, , 0, 0], b = other; let s = 0; let n = 0; for (let k = 0; k < x.length; k++) if (x[k] !== undefined && x[k] !== null) x[n++] = x[k]; s = n; return show([a, b, s, x.length]); }
run("add_0", r_add_0);
run("set_0", r_set_0);
run("two_0", r_two_0);
run("reset_0", r_reset_0);
run("least_0", r_least_0);
run("same_0", r_same_0);
run("rows_0", r_rows_0);
run("mixed_0", r_mixed_0);
run("names_0", r_names_0);
run("calls_0", r_calls_0);
run("filter_0", r_filter_0);
run("filter2_0", r_filter2_0);
run("both_0", r_both_0);
run("stack_0", r_stack_0);
run("unique_0", r_unique_0);
run("merge_0", r_merge_0);
run("compact_0", r_compact_0);
run("add_1", r_add_1);
run("set_1", r_set_1);
run("two_1", r_two_1);
run("reset_1", r_reset_1);
run("least_1", r_least_1);
run("same_1", r_same_1);
run("rows_1", r_rows_1);
run("mixed_1", r_mixed_1);
run("names_1", r_names_1);
run("calls_1", r_calls_1);
run("filter_1", r_filter_1);
run("filter2_1", r_filter2_1);
run("both_1", r_both_1);
run("stack_1", r_stack_1);
run("unique_1", r_unique_1);
run("merge_1", r_merge_1);
run("compact_1", r_compact_1);
run("add_2", r_add_2);
run("set_2", r_set_2);
run("two_2", r_two_2);
run("reset_2", r_reset_2);
run("least_2", r_least_2);
run("same_2", r_same_2);
run("rows_2", r_rows_2);
run("mixed_2", r_mixed_2);
run("names_2", r_names_2);
run("calls_2", r_calls_2);
run("filter_2", r_filter_2);
run("filter2_2", r_filter2_2);
run("both_2", r_both_2);
run("stack_2", r_stack_2);
run("unique_2", r_unique_2);
run("merge_2", r_merge_2);
run("compact_2", r_compact_2);
run("add_3", r_add_3);
run("set_3", r_set_3);
run("two_3", r_two_3);
run("reset_3", r_reset_3);
run("least_3", r_least_3);
run("same_3", r_same_3);
run("rows_3", r_rows_3);
run("mixed_3", r_mixed_3);
run("names_3", r_names_3);
run("calls_3", r_calls_3);
run("filter_3", r_filter_3);
run("filter2_3", r_filter2_3);
run("both_3", r_both_3);
run("stack_3", r_stack_3);
run("unique_3", r_unique_3);
run("merge_3", r_merge_3);
run("compact_3", r_compact_3);
run("add_4", r_add_4);
run("set_4", r_set_4);
run("two_4", r_two_4);
run("reset_4", r_reset_4);
run("least_4", r_least_4);
run("same_4", r_same_4);
run("rows_4", r_rows_4);
run("mixed_4", r_mixed_4);
run("names_4", r_names_4);
run("calls_4", r_calls_4);
run("filter_4", r_filter_4);
run("filter2_4", r_filter2_4);
run("both_4", r_both_4);
run("stack_4", r_stack_4);
run("unique_4", r_unique_4);
run("merge_4", r_merge_4);
run("compact_4", r_compact_4);
run("add_5", r_add_5);
run("set_5", r_set_5);
run("two_5", r_two_5);
run("reset_5", r_reset_5);
run("least_5", r_least_5);
run("same_5", r_same_5);
run("rows_5", r_rows_5);
run("mixed_5", r_mixed_5);
run("names_5", r_names_5);
run("calls_5", r_calls_5);
run("filter_5", r_filter_5);
run("filter2_5", r_filter2_5);
run("both_5", r_both_5);
run("stack_5", r_stack_5);
run("unique_5", r_unique_5);
run("merge_5", r_merge_5);
run("compact_5", r_compact_5);
run("add_6", r_add_6);
run("set_6", r_set_6);
run("two_6", r_two_6);
run("reset_6", r_reset_6);
run("least_6", r_least_6);
run("same_6", r_same_6);
run("rows_6", r_rows_6);
run("mixed_6", r_mixed_6);
run("names_6", r_names_6);
run("calls_6", r_calls_6);
run("filter_6", r_filter_6);
run("filter2_6", r_filter2_6);
run("both_6", r_both_6);
run("stack_6", r_stack_6);
run("unique_6", r_unique_6);
run("merge_6", r_merge_6);
run("compact_6", r_compact_6);
console.log(cases, digest); for (const x of said) console.log(x);

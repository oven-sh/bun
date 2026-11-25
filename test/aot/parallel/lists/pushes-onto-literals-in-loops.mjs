// Literals that loops push onto, or store into under their own length.
// STATISTIC: StoresGrowingArrays >= 20
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 2 ? "..." : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length + (x.length > 9 ? show(x[x.length - 1], 2) + x.reduce((a, b) => typeof b === "number" ? a + b : a + 1, 0) : "") + Object.keys(x).length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
function f2(o, i) { return o.length * i & 7; }
const numbers = JSON.parse("[[1,2,3,4,5],[0.5,1.5,2.5],[7,0.25,-3,2147483647,9],[]]"), others = [["a", "b"], [1, undefined, 3], [null, 2], [1, , 3]];
const values = [() => 3, () => 0.5, () => -0, () => NaN, () => 2147483647, () => "t", () => undefined, () => null, () => ({ valueOf() { calls++; return 2; } }), () => 5n];
const counts = [0, 1, 2, 3, 7, 40, 700];
function run(name, f) { for (let k = 0; k < values.length; k++) for (let c = k % 3; c < counts.length; c += 1 + (k & 1)) { calls = 0; const x = k < 6 ? numbers[(c + k) % 4] : others[(c + k) % 4]; let answer; try { answer = f(x, counts[c], values[k](), values[(k * 3 + c) % values.length]()); } catch (e) { answer = e && e.constructor ? e.constructor.name : typeof e; } keep(name + " " + answer + calls); } }
function a_of_push_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_push_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); } return show([o, s, o.length, p]); }
function a_down_length_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = v; } return show([o, s, o.length, p]); }
function a_len_length_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = v; } return show([o, s, o.length, p]); }
function* G_while_element_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(x[i % x.length]); i++; } yield show([o, s, o.length, p]); } const a_while_element_0 = (...r) => [...G_while_element_0(...r)][0];
function* G_of_element_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(x[i % x.length]); i++; } yield show([o, s, o.length, p]); } const a_of_element_0 = (...r) => [...G_of_element_0(...r)][0];
function* G_len_own_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = x[i % x.length]; } yield show([o, s, o.length, p]); } const a_len_own_0 = (...r) => [...G_len_own_0(...r)][0];
function* G_for_own_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = x[i % x.length]; } yield show([o, s, o.length, p]); } const a_for_own_0 = (...r) => [...G_for_own_0(...r)][0];
function a_down_prefix_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function a_len_prefix_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function a_down_behind_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
function a_len_behind_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
function a_for_twice_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_while_twice_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); }
function a_of_both_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); }
function a_down_both_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_of_cond_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_cond_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
class C_down_either_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); } } const a_down_either_0 = (...r) => new C_down_either_0().m(...r);
class C_len_either_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); } } const a_len_either_0 = (...r) => new C_len_either_0().m(...r);
function a_down_answer_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += o.push(v); } return show([o, s, o.length, p]); }
function a_len_answer_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += o.push(v); } return show([o, s, o.length, p]); }
function a_while_answers_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); }
function a_of_answers_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); }
function* G_for_lists_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); p.push(w); s += p.length; } yield show([o, s, o.length, p]); } const a_for_lists_0 = (...r) => [...G_for_lists_0(...r)][0];
function* G_while_lists_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); p.push(w); s += p.length; i++; } yield show([o, s, o.length, p]); } const a_while_lists_0 = (...r) => [...G_while_lists_0(...r)][0];
function a_for_alias_0(x, n, v, w) { const o = []; const q = o, p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
function a_while_alias_0(x, n, v, w) { const o = []; const q = o, p = []; let s = 0; let i = 0; while (i < n) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); }
function* G_of_pops_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i % 5 === 4) o.pop(); i++; } yield show([o, s, o.length, p]); } const a_of_pops_0 = (...r) => [...G_of_pops_0(...r)][0];
function* G_down_pops_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i % 5 === 4) o.pop(); } yield show([o, s, o.length, p]); } const a_down_pops_0 = (...r) => [...G_down_pops_0(...r)][0];
class C_for_stack_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); } } const a_for_stack_0 = (...r) => new C_for_stack_0().m(...r);
class C_while_stack_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); } } const a_while_stack_0 = (...r) => new C_while_stack_0().m(...r);
class C_while_shrinks_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); } } const a_while_shrinks_0 = (...r) => new C_while_shrinks_0().m(...r);
class C_of_shrinks_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); } } const a_of_shrinks_0 = (...r) => new C_of_shrinks_0().m(...r);
function a_for_reads_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
function a_while_reads_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); }
const a_of_over_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); })[0];
const a_down_over_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); })[0];
function a_down_update_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
function a_len_update_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
function a_for_after_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
function a_while_after_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); }
class C_for_calls_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); } } const a_for_calls_0 = (...r) => new C_for_calls_0().m(...r);
class C_while_calls_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); } } const a_while_calls_0 = (...r) => new C_while_calls_0().m(...r);
function a_for_given_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function a_while_given_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); }
function* G_len_sum_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += v; o.push(s); } yield show([o, s, o.length, p]); } const a_len_sum_0 = (...r) => [...G_len_sum_0(...r)][0];
function* G_for_sum_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += v; o.push(s); } yield show([o, s, o.length, p]); } const a_for_sum_0 = (...r) => [...G_for_sum_0(...r)][0];
class C_len_max_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); } } const a_len_max_0 = (...r) => new C_len_max_0().m(...r);
class C_for_max_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); } } const a_for_max_0 = (...r) => new C_for_max_0().m(...r);
function a_of_left_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); }
function a_down_left_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
function a_down_goes_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_of_ints_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i); i++; } return show([o, s, o.length, p]); }
function a_down_ints_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i); } return show([o, s, o.length, p]); }
function a_while_doubles_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); }
function a_of_doubles_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); }
function a_down_joined_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v + ""); } return show([o, s, o.length, p]); }
function a_len_joined_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v + ""); } return show([o, s, o.length, p]); }
function* G_of_made_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push([v]); i++; } yield show([o, s, o.length, p]); } const a_of_made_0 = (...r) => [...G_of_made_0(...r)][0];
function* G_down_made_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push([v]); } yield show([o, s, o.length, p]); } const a_down_made_0 = (...r) => [...G_down_made_0(...r)][0];
const a_for_inner_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); })[0];
const a_while_inner_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); })[0];
function a_of_rows_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); }
function a_down_rows_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
const a_of_self_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_down_self_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); })[0];
function* G_of_late_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } yield show([o, s, o.length, p]); } const a_of_late_0 = (...r) => [...G_of_late_0(...r)][0];
function* G_down_late_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } yield show([o, s, o.length, p]); } const a_down_late_0 = (...r) => [...G_down_late_0(...r)][0];
function a_len_odd_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
function a_for_odd_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
const a_for_moves_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); })[0];
const a_while_moves_0 = (x, n, v, w) => [0].map(() => { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); })[0];
function a_for_named_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function a_while_named_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; while (i < n) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); }
function* G_down_spread_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(...[v, w]); } yield show([o, s, o.length, p]); } const a_down_spread_0 = (...r) => [...G_down_spread_0(...r)][0];
function* G_len_spread_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(...[v, w]); } yield show([o, s, o.length, p]); } const a_len_spread_0 = (...r) => [...G_len_spread_0(...r)][0];
function a_of_none_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(); i++; } return show([o, s, o.length, p]); }
function a_down_none_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(); } return show([o, s, o.length, p]); }
class C_len_two_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v, w); } return show([o, s, o.length, p]); } } const a_len_two_0 = (...r) => new C_len_two_0().m(...r);
class C_for_two_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v, w); } return show([o, s, o.length, p]); } } const a_for_two_0 = (...r) => new C_for_two_0().m(...r);
function* G_of_call_0(x, n, v, w) { const o = []; const p = []; let s = 0; let i = 0; for (const e of x) { o.push.call(o, v); i++; } yield show([o, s, o.length, p]); } const a_of_call_0 = (...r) => [...G_of_call_0(...r)][0];
function* G_down_call_0(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push.call(o, v); } yield show([o, s, o.length, p]); } const a_down_call_0 = (...r) => [...G_down_call_0(...r)][0];
class C_down_throws_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); } } const a_down_throws_0 = (...r) => new C_down_throws_0().m(...r);
class C_len_throws_0 { m(x, n, v, w) { const o = []; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); } } const a_len_throws_0 = (...r) => new C_len_throws_0().m(...r);
function a_for_push_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); } return show([o, s, o.length, p]); }
function a_while_push_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); i++; } return show([o, s, o.length, p]); }
function a_while_length_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = v; i++; } return show([o, s, o.length, p]); }
function a_of_length_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = v; i++; } return show([o, s, o.length, p]); }
class C_len_element_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); } } const a_len_element_1 = (...r) => new C_len_element_1().m(...r);
class C_for_element_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); } } const a_for_element_1 = (...r) => new C_for_element_1().m(...r);
class C_of_own_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); } } const a_of_own_1 = (...r) => new C_of_own_1().m(...r);
class C_down_own_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); } } const a_down_own_1 = (...r) => new C_down_own_1().m(...r);
function a_while_prefix_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); }
function a_of_prefix_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); }
function* G_while_behind_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[i] + v); i++; } yield show([o, s, o.length, p]); } const a_while_behind_1 = (...r) => [...G_while_behind_1(...r)][0];
function* G_of_behind_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[i] + v); i++; } yield show([o, s, o.length, p]); } const a_of_behind_1 = (...r) => [...G_of_behind_1(...r)][0];
function a_down_twice_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_len_twice_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_for_both_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_while_both_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); }
function a_for_cond_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
function a_while_cond_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); }
const a_while_either_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); })[0];
const a_of_either_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); })[0];
function a_while_answer_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { s += o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_answer_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { s += o.push(v); i++; } return show([o, s, o.length, p]); }
function a_len_answers_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); }
function a_for_answers_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); }
class C_down_lists_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); } } const a_down_lists_1 = (...r) => new C_down_lists_1().m(...r);
class C_len_lists_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); } } const a_len_lists_1 = (...r) => new C_len_lists_1().m(...r);
function a_down_alias_1(x, n, v, w) { const o = [0]; const q = o, p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
function a_len_alias_1(x, n, v, w) { const o = [0]; const q = o, p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
class C_for_pops_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); } } const a_for_pops_1 = (...r) => new C_for_pops_1().m(...r);
class C_while_pops_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); } } const a_while_pops_1 = (...r) => new C_while_pops_1().m(...r);
const a_down_stack_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); })[0];
const a_len_stack_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); })[0];
const a_len_shrinks_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); })[0];
const a_for_shrinks_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); })[0];
function* G_down_reads_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } yield show([o, s, o.length, p]); } const a_down_reads_1 = (...r) => [...G_down_reads_1(...r)][0];
function* G_len_reads_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } yield show([o, s, o.length, p]); } const a_len_reads_1 = (...r) => [...G_len_reads_1(...r)][0];
function a_for_over_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_while_over_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); }
function a_while_update_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); }
function a_of_update_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); }
function* G_down_after_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } yield show([o, s, o.length, p]); } const a_down_after_1 = (...r) => [...G_down_after_1(...r)][0];
function* G_len_after_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } yield show([o, s, o.length, p]); } const a_len_after_1 = (...r) => [...G_len_after_1(...r)][0];
const a_down_calls_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); })[0];
const a_len_calls_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); })[0];
function* G_down_given_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(f2(o, i)); } yield show([o, s, o.length, p]); } const a_down_given_1 = (...r) => [...G_down_given_1(...r)][0];
function* G_len_given_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(f2(o, i)); } yield show([o, s, o.length, p]); } const a_len_given_1 = (...r) => [...G_len_given_1(...r)][0];
class C_of_sum_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); } } const a_of_sum_1 = (...r) => new C_of_sum_1().m(...r);
class C_down_sum_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += v; o.push(s); } return show([o, s, o.length, p]); } } const a_down_sum_1 = (...r) => new C_down_sum_1().m(...r);
const a_of_max_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); })[0];
const a_down_max_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); })[0];
function a_for_left_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
function a_while_left_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); }
function a_for_goes_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_for_ints_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i); } return show([o, s, o.length, p]); }
function a_while_ints_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i); i++; } return show([o, s, o.length, p]); }
function a_len_doubles_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); }
function a_for_doubles_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); }
function a_while_joined_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v + ""); i++; } return show([o, s, o.length, p]); }
function a_of_joined_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v + ""); i++; } return show([o, s, o.length, p]); }
class C_for_made_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push([v]); } return show([o, s, o.length, p]); } } const a_for_made_1 = (...r) => new C_for_made_1().m(...r);
class C_while_made_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push([v]); i++; } return show([o, s, o.length, p]); } } const a_while_made_1 = (...r) => new C_while_made_1().m(...r);
function a_down_inner_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function a_len_inner_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function a_for_rows_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_while_rows_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); }
function a_for_self_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
function a_while_self_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); }
class C_for_late_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); } } const a_for_late_1 = (...r) => new C_for_late_1().m(...r);
class C_while_late_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); } } const a_while_late_1 = (...r) => new C_while_late_1().m(...r);
function a_of_odd_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); }
function a_down_odd_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
function a_down_moves_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
function a_len_moves_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
function* G_down_named_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const m = o; m.push(v); } yield show([o, s, o.length, p]); } const a_down_named_1 = (...r) => [...G_down_named_1(...r)][0];
function* G_len_named_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const m = o; m.push(v); } yield show([o, s, o.length, p]); } const a_len_named_1 = (...r) => [...G_len_named_1(...r)][0];
class C_while_spread_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); } } const a_while_spread_1 = (...r) => new C_while_spread_1().m(...r);
class C_of_spread_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); } } const a_of_spread_1 = (...r) => new C_of_spread_1().m(...r);
function a_for_none_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(); } return show([o, s, o.length, p]); }
function a_while_none_1(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(); i++; } return show([o, s, o.length, p]); }
const a_of_two_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v, w); i++; } return show([o, s, o.length, p]); })[0];
const a_down_two_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v, w); } return show([o, s, o.length, p]); })[0];
class C_for_call_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); } } const a_for_call_1 = (...r) => new C_for_call_1().m(...r);
class C_while_call_1 { m(x, n, v, w) { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); } } const a_while_call_1 = (...r) => new C_while_call_1().m(...r);
const a_while_throws_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; while (i < n) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); })[0];
const a_of_throws_1 = (x, n, v, w) => [0].map(() => { const o = [0]; const p = []; let s = 0; let i = 0; for (const e of x) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); })[0];
function* G_down_push_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); } yield show([o, s, o.length, p]); } const a_down_push_2 = (...r) => [...G_down_push_2(...r)][0];
function* G_len_push_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); } yield show([o, s, o.length, p]); } const a_len_push_2 = (...r) => [...G_len_push_2(...r)][0];
function* G_len_length_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = v; } yield show([o, s, o.length, p]); } const a_len_length_2 = (...r) => [...G_len_length_2(...r)][0];
function* G_for_length_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = v; } yield show([o, s, o.length, p]); } const a_for_length_2 = (...r) => [...G_for_length_2(...r)][0];
const a_of_element_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); })[0];
const a_down_element_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); })[0];
const a_for_own_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); })[0];
const a_while_own_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); })[0];
function* G_len_prefix_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[o.length - 1] + v); } yield show([o, s, o.length, p]); } const a_len_prefix_2 = (...r) => [...G_len_prefix_2(...r)][0];
function* G_for_prefix_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[o.length - 1] + v); } yield show([o, s, o.length, p]); } const a_for_prefix_2 = (...r) => [...G_for_prefix_2(...r)][0];
class C_len_behind_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); } } const a_len_behind_2 = (...r) => new C_len_behind_2().m(...r);
class C_for_behind_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); } } const a_for_behind_2 = (...r) => new C_for_behind_2().m(...r);
function a_while_twice_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); }
function a_of_twice_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); }
function a_down_both_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_len_both_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_down_cond_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
function a_len_cond_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
function a_len_either_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_for_either_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_len_answer_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += o.push(v); } return show([o, s, o.length, p]); }
function a_for_answer_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += o.push(v); } return show([o, s, o.length, p]); }
function* G_of_answers_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { s = o.push(o.push(v)); i++; } yield show([o, s, o.length, p]); } const a_of_answers_2 = (...r) => [...G_of_answers_2(...r)][0];
function* G_down_answers_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s = o.push(o.push(v)); } yield show([o, s, o.length, p]); } const a_down_answers_2 = (...r) => [...G_down_answers_2(...r)][0];
const a_while_lists_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); })[0];
const a_of_lists_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); })[0];
function a_while_alias_2(x, n, v, w) { const o = [0.5]; const q = o, p = []; let s = 0; let i = 0; while (i < n) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); }
function a_of_alias_2(x, n, v, w) { const o = [0.5]; const q = o, p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); }
const a_down_pops_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); })[0];
const a_len_pops_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); })[0];
function a_while_stack_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_stack_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_shrinks_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); }
function a_down_shrinks_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
class C_while_reads_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); } } const a_while_reads_2 = (...r) => new C_while_reads_2().m(...r);
class C_of_reads_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); } } const a_of_reads_2 = (...r) => new C_of_reads_2().m(...r);
function a_down_over_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_len_over_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_len_update_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
function a_for_update_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
class C_while_after_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); } } const a_while_after_2 = (...r) => new C_while_after_2().m(...r);
class C_of_after_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); } } const a_of_after_2 = (...r) => new C_of_after_2().m(...r);
function a_while_calls_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); }
function a_of_calls_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); }
class C_while_given_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); } } const a_while_given_2 = (...r) => new C_while_given_2().m(...r);
class C_of_given_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); } } const a_of_given_2 = (...r) => new C_of_given_2().m(...r);
const a_for_sum_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); })[0];
const a_while_sum_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); })[0];
function a_for_max_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
function a_while_max_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); }
function* G_down_left_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === n - 2) break; } yield show([o, s, o.length, p]); } const a_down_left_2 = (...r) => [...G_down_left_2(...r)][0];
function* G_len_left_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === n - 2) break; } yield show([o, s, o.length, p]); } const a_len_left_2 = (...r) => [...G_len_left_2(...r)][0];
function a_down_goes_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_len_goes_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function* G_down_ints_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i); } yield show([o, s, o.length, p]); } const a_down_ints_2 = (...r) => [...G_down_ints_2(...r)][0];
function* G_len_ints_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i); } yield show([o, s, o.length, p]); } const a_len_ints_2 = (...r) => [...G_len_ints_2(...r)][0];
function* G_of_doubles_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i * 0.5); i++; } yield show([o, s, o.length, p]); } const a_of_doubles_2 = (...r) => [...G_of_doubles_2(...r)][0];
function* G_down_doubles_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i * 0.5); } yield show([o, s, o.length, p]); } const a_down_doubles_2 = (...r) => [...G_down_doubles_2(...r)][0];
function a_len_joined_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v + ""); } return show([o, s, o.length, p]); }
function a_for_joined_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v + ""); } return show([o, s, o.length, p]); }
const a_down_made_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push([v]); } return show([o, s, o.length, p]); })[0];
const a_len_made_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push([v]); } return show([o, s, o.length, p]); })[0];
function a_while_inner_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_inner_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_rows_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_len_rows_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_down_self_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
function a_len_self_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
const a_down_late_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); })[0];
const a_len_late_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); })[0];
function* G_for_odd_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i % 4 === 3 ? w : v); } yield show([o, s, o.length, p]); } const a_for_odd_2 = (...r) => [...G_for_odd_2(...r)][0];
function* G_while_odd_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i % 4 === 3 ? w : v); i++; } yield show([o, s, o.length, p]); } const a_while_odd_2 = (...r) => [...G_while_odd_2(...r)][0];
function a_while_moves_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); }
function a_of_moves_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); }
class C_while_named_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); } } const a_while_named_2 = (...r) => new C_while_named_2().m(...r);
class C_of_named_2 { m(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; for (const e of x) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); } } const a_of_named_2 = (...r) => new C_of_named_2().m(...r);
const a_len_spread_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); })[0];
const a_for_spread_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); })[0];
function a_down_none_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(); } return show([o, s, o.length, p]); }
function a_len_none_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(); } return show([o, s, o.length, p]); }
function a_for_two_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_while_two_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v, w); i++; } return show([o, s, o.length, p]); }
const a_down_call_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push.call(o, v); } return show([o, s, o.length, p]); })[0];
const a_len_call_2 = (x, n, v, w) => [0].map(() => { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); })[0];
function a_len_throws_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
function a_for_throws_2(x, n, v, w) { const o = [0.5]; const p = []; let s = 0; for (let i = 0; i < n; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
class C_while_push_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); i++; } return show([o, s, o.length, p]); } } const a_while_push_3 = (...r) => new C_while_push_3().m(...r);
class C_of_push_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); i++; } return show([o, s, o.length, p]); } } const a_of_push_3 = (...r) => new C_of_push_3().m(...r);
class C_of_length_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = v; i++; } return show([o, s, o.length, p]); } } const a_of_length_3 = (...r) => new C_of_length_3().m(...r);
class C_down_length_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = v; } return show([o, s, o.length, p]); } } const a_down_length_3 = (...r) => new C_down_length_3().m(...r);
function a_for_element_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); }
function a_while_element_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); }
function a_down_own_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
function a_len_own_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
class C_of_prefix_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); } } const a_of_prefix_3 = (...r) => new C_of_prefix_3().m(...r);
class C_down_prefix_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); } } const a_down_prefix_3 = (...r) => new C_down_prefix_3().m(...r);
const a_of_behind_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); })[0];
const a_down_behind_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[i] + v); } return show([o, s, o.length, p]); })[0];
function* G_len_twice_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o.push(w); } yield show([o, s, o.length, p]); } const a_len_twice_3 = (...r) => [...G_len_twice_3(...r)][0];
function* G_for_twice_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o.push(w); } yield show([o, s, o.length, p]); } const a_for_twice_3 = (...r) => [...G_for_twice_3(...r)][0];
function* G_while_both_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[o.length] = w; i++; } yield show([o, s, o.length, p]); } const a_while_both_3 = (...r) => [...G_while_both_3(...r)][0];
function* G_of_both_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[o.length] = w; i++; } yield show([o, s, o.length, p]); } const a_of_both_3 = (...r) => [...G_of_both_3(...r)][0];
function* G_while_cond_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { if (i % 3) o.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_cond_3 = (...r) => [...G_while_cond_3(...r)][0];
function* G_of_cond_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i % 3) o.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_cond_3 = (...r) => [...G_of_cond_3(...r)][0];
function a_of_either_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); }
function a_down_either_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function* G_of_answer_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { s += o.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_answer_3 = (...r) => [...G_of_answer_3(...r)][0];
function* G_down_answer_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += o.push(v); } yield show([o, s, o.length, p]); } const a_down_answer_3 = (...r) => [...G_down_answer_3(...r)][0];
class C_for_answers_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); } } const a_for_answers_3 = (...r) => new C_for_answers_3().m(...r);
class C_while_answers_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); } } const a_while_answers_3 = (...r) => new C_while_answers_3().m(...r);
function a_len_lists_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
function a_for_lists_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
function* G_len_alias_3(x, n, v, w) { const o = [1, 2]; const q = o, p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); q.push(w); } yield show([o, s, o.length, p]); } const a_len_alias_3 = (...r) => [...G_len_alias_3(...r)][0];
function* G_for_alias_3(x, n, v, w) { const o = [1, 2]; const q = o, p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); q.push(w); } yield show([o, s, o.length, p]); } const a_for_alias_3 = (...r) => [...G_for_alias_3(...r)][0];
function a_while_pops_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); }
function a_of_pops_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); }
function a_len_stack_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_for_stack_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_for_shrinks_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
function a_while_shrinks_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); }
const a_len_reads_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); })[0];
const a_for_reads_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); })[0];
function a_while_over_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); }
function a_of_over_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); }
function* G_of_update_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[i] = o[i] * 2; i++; } yield show([o, s, o.length, p]); } const a_of_update_3 = (...r) => [...G_of_update_3(...r)][0];
function* G_down_update_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[i] = o[i] * 2; } yield show([o, s, o.length, p]); } const a_down_update_3 = (...r) => [...G_down_update_3(...r)][0];
const a_len_after_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); })[0];
const a_for_after_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); })[0];
function a_len_calls_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
function a_for_calls_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
const a_len_given_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); })[0];
const a_for_given_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); })[0];
function a_down_sum_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function a_len_sum_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function a_down_max_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
function a_len_max_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
class C_while_left_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); } } const a_while_left_3 = (...r) => new C_while_left_3().m(...r);
class C_of_left_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); } } const a_of_left_3 = (...r) => new C_of_left_3().m(...r);
class C_while_ints_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i); i++; } return show([o, s, o.length, p]); } } const a_while_ints_3 = (...r) => new C_while_ints_3().m(...r);
class C_of_ints_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i); i++; } return show([o, s, o.length, p]); } } const a_of_ints_3 = (...r) => new C_of_ints_3().m(...r);
class C_for_doubles_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); } } const a_for_doubles_3 = (...r) => new C_for_doubles_3().m(...r);
class C_while_doubles_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); } } const a_while_doubles_3 = (...r) => new C_while_doubles_3().m(...r);
function* G_of_joined_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v + ""); i++; } yield show([o, s, o.length, p]); } const a_of_joined_3 = (...r) => [...G_of_joined_3(...r)][0];
function* G_down_joined_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v + ""); } yield show([o, s, o.length, p]); } const a_down_joined_3 = (...r) => [...G_down_joined_3(...r)][0];
function a_while_made_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push([v]); i++; } return show([o, s, o.length, p]); }
function a_of_made_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push([v]); i++; } return show([o, s, o.length, p]); }
function a_len_inner_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function a_for_inner_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function* G_while_rows_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } yield show([o, s, o.length, p]); } const a_while_rows_3 = (...r) => [...G_while_rows_3(...r)][0];
function* G_of_rows_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } yield show([o, s, o.length, p]); } const a_of_rows_3 = (...r) => [...G_of_rows_3(...r)][0];
function a_while_self_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_self_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); }
function a_while_late_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); }
function a_of_late_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); }
class C_down_odd_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); } } const a_down_odd_3 = (...r) => new C_down_odd_3().m(...r);
class C_len_odd_3 { m(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); } } const a_len_odd_3 = (...r) => new C_len_odd_3().m(...r);
function a_len_moves_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
function a_for_moves_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
const a_len_named_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); })[0];
const a_for_named_3 = (x, n, v, w) => [0].map(() => { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); })[0];
function a_of_spread_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); }
function a_down_spread_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
function* G_while_none_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(); i++; } yield show([o, s, o.length, p]); } const a_while_none_3 = (...r) => [...G_while_none_3(...r)][0];
function* G_of_none_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(); i++; } yield show([o, s, o.length, p]); } const a_of_none_3 = (...r) => [...G_of_none_3(...r)][0];
function a_down_two_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_len_two_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_while_call_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); }
function a_of_call_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); }
function a_of_throws_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; let i = 0; for (const e of x) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); }
function a_down_throws_3(x, n, v, w) { const o = [1, 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
const a_len_push_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); } return show([o, s, o.length, p]); })[0];
const a_for_push_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); } return show([o, s, o.length, p]); })[0];
const a_for_length_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = v; } return show([o, s, o.length, p]); })[0];
const a_while_length_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = v; i++; } return show([o, s, o.length, p]); })[0];
function a_down_element_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); }
function a_len_element_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); }
function a_while_own_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); }
function a_of_own_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); }
const a_for_prefix_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); })[0];
const a_while_prefix_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); })[0];
function a_for_behind_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
function a_while_behind_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); }
class C_of_twice_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); } } const a_of_twice_4 = (...r) => new C_of_twice_4().m(...r);
class C_down_twice_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o.push(w); } return show([o, s, o.length, p]); } } const a_down_twice_4 = (...r) => new C_down_twice_4().m(...r);
class C_len_both_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); } } const a_len_both_4 = (...r) => new C_len_both_4().m(...r);
class C_for_both_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); } } const a_for_both_4 = (...r) => new C_for_both_4().m(...r);
class C_len_cond_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); } } const a_len_cond_4 = (...r) => new C_len_cond_4().m(...r);
class C_for_cond_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); } } const a_for_cond_4 = (...r) => new C_for_cond_4().m(...r);
function a_for_either_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_while_either_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); }
class C_for_answer_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += o.push(v); } return show([o, s, o.length, p]); } } const a_for_answer_4 = (...r) => new C_for_answer_4().m(...r);
class C_while_answer_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { s += o.push(v); i++; } return show([o, s, o.length, p]); } } const a_while_answer_4 = (...r) => new C_while_answer_4().m(...r);
const a_down_answers_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); })[0];
const a_len_answers_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); })[0];
function a_of_lists_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); }
function a_down_lists_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
class C_of_alias_4 { m(x, n, v, w) { const o = [w]; const q = o, p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); } } const a_of_alias_4 = (...r) => new C_of_alias_4().m(...r);
class C_down_alias_4 { m(x, n, v, w) { const o = [w]; const q = o, p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); q.push(w); } return show([o, s, o.length, p]); } } const a_down_alias_4 = (...r) => new C_down_alias_4().m(...r);
function a_len_pops_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function a_for_pops_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function a_of_stack_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_stack_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_down_shrinks_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
function a_len_shrinks_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
function a_of_reads_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); }
function a_down_reads_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
function* G_len_over_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[0] = w; } yield show([o, s, o.length, p]); } const a_len_over_4 = (...r) => [...G_len_over_4(...r)][0];
function* G_for_over_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[0] = w; } yield show([o, s, o.length, p]); } const a_for_over_4 = (...r) => [...G_for_over_4(...r)][0];
class C_for_update_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); } } const a_for_update_4 = (...r) => new C_for_update_4().m(...r);
class C_while_update_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); } } const a_while_update_4 = (...r) => new C_while_update_4().m(...r);
function a_of_after_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); }
function a_down_after_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
function a_of_calls_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); }
function a_down_calls_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
function a_of_given_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); }
function a_down_given_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function a_while_sum_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); }
function a_of_sum_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); }
function a_while_max_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); }
function a_of_max_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); }
const a_len_left_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); })[0];
const a_for_left_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); })[0];
class C_len_goes_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); } } const a_len_goes_4 = (...r) => new C_len_goes_4().m(...r);
class C_for_goes_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); } } const a_for_goes_4 = (...r) => new C_for_goes_4().m(...r);
const a_len_ints_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i); } return show([o, s, o.length, p]); })[0];
const a_for_ints_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i); } return show([o, s, o.length, p]); })[0];
const a_down_doubles_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i * 0.5); } return show([o, s, o.length, p]); })[0];
const a_len_doubles_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); })[0];
class C_for_joined_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v + ""); } return show([o, s, o.length, p]); } } const a_for_joined_4 = (...r) => new C_for_joined_4().m(...r);
class C_while_joined_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v + ""); i++; } return show([o, s, o.length, p]); } } const a_while_joined_4 = (...r) => new C_while_joined_4().m(...r);
function a_len_made_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push([v]); } return show([o, s, o.length, p]); }
function a_for_made_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push([v]); } return show([o, s, o.length, p]); }
function* G_of_inner_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { for (let j = 0; j < 3; j++) o.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_inner_4 = (...r) => [...G_of_inner_4(...r)][0];
function* G_down_inner_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { for (let j = 0; j < 3; j++) o.push(v); } yield show([o, s, o.length, p]); } const a_down_inner_4 = (...r) => [...G_down_inner_4(...r)][0];
class C_len_rows_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); } } const a_len_rows_4 = (...r) => new C_len_rows_4().m(...r);
class C_for_rows_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); } } const a_for_rows_4 = (...r) => new C_for_rows_4().m(...r);
function* G_len_self_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i < 3) o.push(o.length); else o.push(v); } yield show([o, s, o.length, p]); } const a_len_self_4 = (...r) => [...G_len_self_4(...r)][0];
function* G_for_self_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i < 3) o.push(o.length); else o.push(v); } yield show([o, s, o.length, p]); } const a_for_self_4 = (...r) => [...G_for_self_4(...r)][0];
function a_len_late_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
function a_for_late_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
const a_while_odd_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); })[0];
const a_of_odd_4 = (x, n, v, w) => [0].map(() => { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); })[0];
function* G_of_moves_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } yield show([o, s, o.length, p]); } const a_of_moves_4 = (...r) => [...G_of_moves_4(...r)][0];
function* G_down_moves_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } yield show([o, s, o.length, p]); } const a_down_moves_4 = (...r) => [...G_down_moves_4(...r)][0];
function a_of_named_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_named_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function a_for_spread_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
function a_while_spread_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); }
class C_len_none_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(); } return show([o, s, o.length, p]); } } const a_len_none_4 = (...r) => new C_len_none_4().m(...r);
class C_for_none_4 { m(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(); } return show([o, s, o.length, p]); } } const a_for_none_4 = (...r) => new C_for_none_4().m(...r);
function a_while_two_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v, w); i++; } return show([o, s, o.length, p]); }
function a_of_two_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v, w); i++; } return show([o, s, o.length, p]); }
function a_len_call_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function a_for_call_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function a_for_throws_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; for (let i = 0; i < n; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
function a_while_throws_4(x, n, v, w) { const o = [w]; const p = []; let s = 0; let i = 0; while (i < n) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); }
function a_of_push_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_push_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); } return show([o, s, o.length, p]); }
function a_down_length_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = v; } return show([o, s, o.length, p]); }
function a_len_length_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = v; } return show([o, s, o.length, p]); }
function a_while_element_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); }
function a_of_element_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); }
function a_len_own_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
function a_for_own_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
function a_down_prefix_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function a_len_prefix_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function a_down_behind_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
function a_len_behind_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
const a_for_twice_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); })[0];
const a_while_twice_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); })[0];
const a_of_both_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); })[0];
const a_down_both_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); })[0];
const a_of_cond_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_down_cond_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); })[0];
function* G_down_either_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i & 1) o.push(v); else o.push(w); } yield show([o, s, o.length, p]); } const a_down_either_5 = (...r) => [...G_down_either_5(...r)][0];
function* G_len_either_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i & 1) o.push(v); else o.push(w); } yield show([o, s, o.length, p]); } const a_len_either_5 = (...r) => [...G_len_either_5(...r)][0];
const a_down_answer_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += o.push(v); } return show([o, s, o.length, p]); })[0];
const a_len_answer_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += o.push(v); } return show([o, s, o.length, p]); })[0];
function a_while_answers_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); }
function a_of_answers_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); }
function a_for_lists_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
function a_while_lists_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); }
const a_for_alias_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const q = o, p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); })[0];
const a_while_alias_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const q = o, p = []; let s = 0; let i = 0; while (i < n) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); })[0];
function a_of_pops_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); }
function a_down_pops_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function* G_for_stack_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } yield show([o, s, o.length, p]); } const a_for_stack_5 = (...r) => [...G_for_stack_5(...r)][0];
function* G_while_stack_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_stack_5 = (...r) => [...G_while_stack_5(...r)][0];
function* G_while_shrinks_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 4) o.length = 2; i++; } yield show([o, s, o.length, p]); } const a_while_shrinks_5 = (...r) => [...G_while_shrinks_5(...r)][0];
function* G_of_shrinks_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 4) o.length = 2; i++; } yield show([o, s, o.length, p]); } const a_of_shrinks_5 = (...r) => [...G_of_shrinks_5(...r)][0];
function a_for_reads_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
function a_while_reads_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); }
class C_of_over_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); } } const a_of_over_5 = (...r) => new C_of_over_5().m(...r);
class C_down_over_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); } } const a_down_over_5 = (...r) => new C_down_over_5().m(...r);
const a_down_update_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); })[0];
const a_len_update_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); })[0];
function a_for_after_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
function a_while_after_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); }
function* G_for_calls_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += f2(o, i); } yield show([o, s, o.length, p]); } const a_for_calls_5 = (...r) => [...G_for_calls_5(...r)][0];
function* G_while_calls_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += f2(o, i); i++; } yield show([o, s, o.length, p]); } const a_while_calls_5 = (...r) => [...G_while_calls_5(...r)][0];
function a_for_given_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function a_while_given_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); }
function a_len_sum_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function a_for_sum_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function* G_len_max_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(Math.max(o[o.length - 1], v)); } yield show([o, s, o.length, p]); } const a_len_max_5 = (...r) => [...G_len_max_5(...r)][0];
function* G_for_max_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(Math.max(o[o.length - 1], v)); } yield show([o, s, o.length, p]); } const a_for_max_5 = (...r) => [...G_for_max_5(...r)][0];
function a_of_left_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); }
function a_down_left_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
const a_down_goes_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); })[0];
function a_of_ints_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i); i++; } return show([o, s, o.length, p]); }
function a_down_ints_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i); } return show([o, s, o.length, p]); }
function a_while_doubles_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); }
function a_of_doubles_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); }
const a_down_joined_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v + ""); } return show([o, s, o.length, p]); })[0];
const a_len_joined_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v + ""); } return show([o, s, o.length, p]); })[0];
function a_of_made_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push([v]); i++; } return show([o, s, o.length, p]); }
function a_down_made_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push([v]); } return show([o, s, o.length, p]); }
class C_for_inner_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); } } const a_for_inner_5 = (...r) => new C_for_inner_5().m(...r);
class C_while_inner_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); } } const a_while_inner_5 = (...r) => new C_while_inner_5().m(...r);
const a_of_rows_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); })[0];
const a_down_rows_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); })[0];
class C_of_self_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); } } const a_of_self_5 = (...r) => new C_of_self_5().m(...r);
class C_down_self_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); } } const a_down_self_5 = (...r) => new C_down_self_5().m(...r);
function a_of_late_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); }
function a_down_late_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
function a_len_odd_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
function a_for_odd_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
class C_for_moves_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); } } const a_for_moves_5 = (...r) => new C_for_moves_5().m(...r);
class C_while_moves_5 { m(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); } } const a_while_moves_5 = (...r) => new C_while_moves_5().m(...r);
function a_for_named_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function a_while_named_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; while (i < n) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_spread_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
function a_len_spread_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
const a_of_none_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(); i++; } return show([o, s, o.length, p]); })[0];
const a_down_none_5 = (x, n, v, w) => [0].map(() => { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(); } return show([o, s, o.length, p]); })[0];
function* G_len_two_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v, w); } yield show([o, s, o.length, p]); } const a_len_two_5 = (...r) => [...G_len_two_5(...r)][0];
function* G_for_two_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v, w); } yield show([o, s, o.length, p]); } const a_for_two_5 = (...r) => [...G_for_two_5(...r)][0];
function a_of_call_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); }
function a_down_call_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function* G_down_throws_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } yield show([o, s, o.length, p]); } const a_down_throws_5 = (...r) => [...G_down_throws_5(...r)][0];
function* G_len_throws_5(x, n, v, w) { const o = [x[0]]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } yield show([o, s, o.length, p]); } const a_len_throws_5 = (...r) => [...G_len_throws_5(...r)][0];
function a_for_push_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); } return show([o, s, o.length, p]); }
function a_while_push_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); i++; } return show([o, s, o.length, p]); }
function a_while_length_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = v; i++; } return show([o, s, o.length, p]); }
function a_of_length_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = v; i++; } return show([o, s, o.length, p]); }
function* G_len_element_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(x[i % x.length]); } yield show([o, s, o.length, p]); } const a_len_element_6 = (...r) => [...G_len_element_6(...r)][0];
function* G_for_element_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(x[i % x.length]); } yield show([o, s, o.length, p]); } const a_for_element_6 = (...r) => [...G_for_element_6(...r)][0];
function* G_of_own_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = x[i % x.length]; i++; } yield show([o, s, o.length, p]); } const a_of_own_6 = (...r) => [...G_of_own_6(...r)][0];
function* G_down_own_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = x[i % x.length]; } yield show([o, s, o.length, p]); } const a_down_own_6 = (...r) => [...G_down_own_6(...r)][0];
function a_while_prefix_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); }
function a_of_prefix_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); }
function a_while_behind_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); }
function a_of_behind_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); }
function a_down_twice_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_len_twice_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_for_both_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_while_both_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); }
function a_for_cond_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
function a_while_cond_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); }
class C_while_either_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); } } const a_while_either_6 = (...r) => new C_while_either_6().m(...r);
class C_of_either_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); } } const a_of_either_6 = (...r) => new C_of_either_6().m(...r);
function a_while_answer_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { s += o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_answer_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { s += o.push(v); i++; } return show([o, s, o.length, p]); }
function a_len_answers_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); }
function a_for_answers_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); }
function* G_down_lists_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); p.push(w); s += p.length; } yield show([o, s, o.length, p]); } const a_down_lists_6 = (...r) => [...G_down_lists_6(...r)][0];
function* G_len_lists_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); p.push(w); s += p.length; } yield show([o, s, o.length, p]); } const a_len_lists_6 = (...r) => [...G_len_lists_6(...r)][0];
function a_down_alias_6(x, n, v, w) { const o = ["t"]; const q = o, p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
function a_len_alias_6(x, n, v, w) { const o = ["t"]; const q = o, p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
function* G_for_pops_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i % 5 === 4) o.pop(); } yield show([o, s, o.length, p]); } const a_for_pops_6 = (...r) => [...G_for_pops_6(...r)][0];
function* G_while_pops_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i % 5 === 4) o.pop(); i++; } yield show([o, s, o.length, p]); } const a_while_pops_6 = (...r) => [...G_while_pops_6(...r)][0];
class C_down_stack_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); } } const a_down_stack_6 = (...r) => new C_down_stack_6().m(...r);
class C_len_stack_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); } } const a_len_stack_6 = (...r) => new C_len_stack_6().m(...r);
class C_len_shrinks_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); } } const a_len_shrinks_6 = (...r) => new C_len_shrinks_6().m(...r);
class C_for_shrinks_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); } } const a_for_shrinks_6 = (...r) => new C_for_shrinks_6().m(...r);
function a_down_reads_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
function a_len_reads_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
const a_for_over_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); })[0];
const a_while_over_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); })[0];
function a_while_update_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); }
function a_of_update_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); }
function a_down_after_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
function a_len_after_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
class C_down_calls_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); } } const a_down_calls_6 = (...r) => new C_down_calls_6().m(...r);
class C_len_calls_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); } } const a_len_calls_6 = (...r) => new C_len_calls_6().m(...r);
function a_down_given_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function a_len_given_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function* G_of_sum_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { s += v; o.push(s); i++; } yield show([o, s, o.length, p]); } const a_of_sum_6 = (...r) => [...G_of_sum_6(...r)][0];
function* G_down_sum_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += v; o.push(s); } yield show([o, s, o.length, p]); } const a_down_sum_6 = (...r) => [...G_down_sum_6(...r)][0];
class C_of_max_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); } } const a_of_max_6 = (...r) => new C_of_max_6().m(...r);
class C_down_max_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); } } const a_down_max_6 = (...r) => new C_down_max_6().m(...r);
function a_for_left_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
function a_while_left_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); }
function a_for_goes_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_for_ints_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i); } return show([o, s, o.length, p]); }
function a_while_ints_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i); i++; } return show([o, s, o.length, p]); }
function a_len_doubles_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); }
function a_for_doubles_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); }
function a_while_joined_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v + ""); i++; } return show([o, s, o.length, p]); }
function a_of_joined_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v + ""); i++; } return show([o, s, o.length, p]); }
function* G_for_made_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push([v]); } yield show([o, s, o.length, p]); } const a_for_made_6 = (...r) => [...G_for_made_6(...r)][0];
function* G_while_made_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push([v]); i++; } yield show([o, s, o.length, p]); } const a_while_made_6 = (...r) => [...G_while_made_6(...r)][0];
const a_down_inner_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); })[0];
const a_len_inner_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); })[0];
function a_for_rows_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_while_rows_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); }
const a_for_self_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); })[0];
const a_while_self_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); })[0];
function* G_for_late_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } yield show([o, s, o.length, p]); } const a_for_late_6 = (...r) => [...G_for_late_6(...r)][0];
function* G_while_late_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } yield show([o, s, o.length, p]); } const a_while_late_6 = (...r) => [...G_while_late_6(...r)][0];
function a_of_odd_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); }
function a_down_odd_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
const a_down_moves_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); })[0];
const a_len_moves_6 = (x, n, v, w) => [0].map(() => { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); })[0];
function a_down_named_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function a_len_named_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function* G_while_spread_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(...[v, w]); i++; } yield show([o, s, o.length, p]); } const a_while_spread_6 = (...r) => [...G_while_spread_6(...r)][0];
function* G_of_spread_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(...[v, w]); i++; } yield show([o, s, o.length, p]); } const a_of_spread_6 = (...r) => [...G_of_spread_6(...r)][0];
function a_for_none_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(); } return show([o, s, o.length, p]); }
function a_while_none_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(); i++; } return show([o, s, o.length, p]); }
class C_of_two_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v, w); i++; } return show([o, s, o.length, p]); } } const a_of_two_6 = (...r) => new C_of_two_6().m(...r);
class C_down_two_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v, w); } return show([o, s, o.length, p]); } } const a_down_two_6 = (...r) => new C_down_two_6().m(...r);
function* G_for_call_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push.call(o, v); } yield show([o, s, o.length, p]); } const a_for_call_6 = (...r) => [...G_for_call_6(...r)][0];
function* G_while_call_6(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { o.push.call(o, v); i++; } yield show([o, s, o.length, p]); } const a_while_call_6 = (...r) => [...G_while_call_6(...r)][0];
class C_while_throws_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; while (i < n) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); } } const a_while_throws_6 = (...r) => new C_while_throws_6().m(...r);
class C_of_throws_6 { m(x, n, v, w) { const o = ["t"]; const p = []; let s = 0; let i = 0; for (const e of x) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); } } const a_of_throws_6 = (...r) => new C_of_throws_6().m(...r);
function a_down_push_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); } return show([o, s, o.length, p]); }
function a_len_push_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); } return show([o, s, o.length, p]); }
function a_len_length_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = v; } return show([o, s, o.length, p]); }
function a_for_length_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = v; } return show([o, s, o.length, p]); }
class C_of_element_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); } } const a_of_element_7 = (...r) => new C_of_element_7().m(...r);
class C_down_element_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); } } const a_down_element_7 = (...r) => new C_down_element_7().m(...r);
class C_for_own_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); } } const a_for_own_7 = (...r) => new C_for_own_7().m(...r);
class C_while_own_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); } } const a_while_own_7 = (...r) => new C_while_own_7().m(...r);
function a_len_prefix_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function a_for_prefix_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); }
function* G_len_behind_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[i] + v); } yield show([o, s, o.length, p]); } const a_len_behind_7 = (...r) => [...G_len_behind_7(...r)][0];
function* G_for_behind_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[i] + v); } yield show([o, s, o.length, p]); } const a_for_behind_7 = (...r) => [...G_for_behind_7(...r)][0];
function a_while_twice_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); }
function a_of_twice_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); }
function a_down_both_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_len_both_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); }
function a_down_cond_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
function a_len_cond_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); }
const a_len_either_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); })[0];
const a_for_either_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); })[0];
function a_len_answer_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += o.push(v); } return show([o, s, o.length, p]); }
function a_for_answer_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += o.push(v); } return show([o, s, o.length, p]); }
function a_of_answers_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); }
function a_down_answers_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); }
class C_while_lists_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); } } const a_while_lists_7 = (...r) => new C_while_lists_7().m(...r);
class C_of_lists_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); } } const a_of_lists_7 = (...r) => new C_of_lists_7().m(...r);
function a_while_alias_7(x, n, v, w) { const o = [0, , 2]; const q = o, p = []; let s = 0; let i = 0; while (i < n) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); }
function a_of_alias_7(x, n, v, w) { const o = [0, , 2]; const q = o, p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); }
class C_down_pops_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); } } const a_down_pops_7 = (...r) => new C_down_pops_7().m(...r);
class C_len_pops_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); } } const a_len_pops_7 = (...r) => new C_len_pops_7().m(...r);
const a_while_stack_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_of_stack_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_of_shrinks_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); })[0];
const a_down_shrinks_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); })[0];
function* G_while_reads_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } yield show([o, s, o.length, p]); } const a_while_reads_7 = (...r) => [...G_while_reads_7(...r)][0];
function* G_of_reads_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } yield show([o, s, o.length, p]); } const a_of_reads_7 = (...r) => [...G_of_reads_7(...r)][0];
function a_down_over_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_len_over_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_len_update_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
function a_for_update_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
function* G_while_after_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } yield show([o, s, o.length, p]); } const a_while_after_7 = (...r) => [...G_while_after_7(...r)][0];
function* G_of_after_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } yield show([o, s, o.length, p]); } const a_of_after_7 = (...r) => [...G_of_after_7(...r)][0];
const a_while_calls_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); })[0];
const a_of_calls_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); })[0];
function* G_while_given_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(f2(o, i)); i++; } yield show([o, s, o.length, p]); } const a_while_given_7 = (...r) => [...G_while_given_7(...r)][0];
function* G_of_given_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(f2(o, i)); i++; } yield show([o, s, o.length, p]); } const a_of_given_7 = (...r) => [...G_of_given_7(...r)][0];
class C_for_sum_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); } } const a_for_sum_7 = (...r) => new C_for_sum_7().m(...r);
class C_while_sum_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); } } const a_while_sum_7 = (...r) => new C_while_sum_7().m(...r);
const a_for_max_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); })[0];
const a_while_max_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); })[0];
function a_down_left_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
function a_len_left_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); }
function a_down_goes_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_len_goes_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); }
function a_down_ints_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i); } return show([o, s, o.length, p]); }
function a_len_ints_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i); } return show([o, s, o.length, p]); }
function a_of_doubles_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); }
function a_down_doubles_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i * 0.5); } return show([o, s, o.length, p]); }
function a_len_joined_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v + ""); } return show([o, s, o.length, p]); }
function a_for_joined_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v + ""); } return show([o, s, o.length, p]); }
class C_down_made_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push([v]); } return show([o, s, o.length, p]); } } const a_down_made_7 = (...r) => new C_down_made_7().m(...r);
class C_len_made_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push([v]); } return show([o, s, o.length, p]); } } const a_len_made_7 = (...r) => new C_len_made_7().m(...r);
function a_while_inner_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_inner_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_rows_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_len_rows_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); }
function a_down_self_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
function a_len_self_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
class C_down_late_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); } } const a_down_late_7 = (...r) => new C_down_late_7().m(...r);
class C_len_late_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); } } const a_len_late_7 = (...r) => new C_len_late_7().m(...r);
function a_for_odd_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); }
function a_while_odd_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); }
function a_while_moves_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); }
function a_of_moves_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); }
function* G_while_named_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { const m = o; m.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_named_7 = (...r) => [...G_while_named_7(...r)][0];
function* G_of_named_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; let i = 0; for (const e of x) { const m = o; m.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_named_7 = (...r) => [...G_of_named_7(...r)][0];
class C_len_spread_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); } } const a_len_spread_7 = (...r) => new C_len_spread_7().m(...r);
class C_for_spread_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); } } const a_for_spread_7 = (...r) => new C_for_spread_7().m(...r);
function a_down_none_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(); } return show([o, s, o.length, p]); }
function a_len_none_7(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(); } return show([o, s, o.length, p]); }
const a_for_two_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v, w); } return show([o, s, o.length, p]); })[0];
const a_while_two_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v, w); i++; } return show([o, s, o.length, p]); })[0];
class C_down_call_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push.call(o, v); } return show([o, s, o.length, p]); } } const a_down_call_7 = (...r) => new C_down_call_7().m(...r);
class C_len_call_7 { m(x, n, v, w) { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); } } const a_len_call_7 = (...r) => new C_len_call_7().m(...r);
const a_len_throws_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); })[0];
const a_for_throws_7 = (x, n, v, w) => [0].map(() => { const o = [0, , 2]; const p = []; let s = 0; for (let i = 0; i < n; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); })[0];
function* G_while_push_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_push_8 = (...r) => [...G_while_push_8(...r)][0];
function* G_of_push_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_push_8 = (...r) => [...G_of_push_8(...r)][0];
function* G_of_length_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = v; i++; } yield show([o, s, o.length, p]); } const a_of_length_8 = (...r) => [...G_of_length_8(...r)][0];
function* G_down_length_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = v; } yield show([o, s, o.length, p]); } const a_down_length_8 = (...r) => [...G_down_length_8(...r)][0];
const a_for_element_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); })[0];
const a_while_element_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); })[0];
const a_down_own_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); })[0];
const a_len_own_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); })[0];
function* G_of_prefix_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[o.length - 1] + v); i++; } yield show([o, s, o.length, p]); } const a_of_prefix_8 = (...r) => [...G_of_prefix_8(...r)][0];
function* G_down_prefix_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[o.length - 1] + v); } yield show([o, s, o.length, p]); } const a_down_prefix_8 = (...r) => [...G_down_prefix_8(...r)][0];
class C_of_behind_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); } } const a_of_behind_8 = (...r) => new C_of_behind_8().m(...r);
class C_down_behind_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[i] + v); } return show([o, s, o.length, p]); } } const a_down_behind_8 = (...r) => new C_down_behind_8().m(...r);
function a_len_twice_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_for_twice_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); }
function a_while_both_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); }
function a_of_both_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); }
function a_while_cond_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_cond_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_either_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); }
function a_down_either_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_of_answer_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { s += o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_answer_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += o.push(v); } return show([o, s, o.length, p]); }
function* G_for_answers_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s = o.push(o.push(v)); } yield show([o, s, o.length, p]); } const a_for_answers_8 = (...r) => [...G_for_answers_8(...r)][0];
function* G_while_answers_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { s = o.push(o.push(v)); i++; } yield show([o, s, o.length, p]); } const a_while_answers_8 = (...r) => [...G_while_answers_8(...r)][0];
const a_len_lists_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); })[0];
const a_for_lists_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); })[0];
function a_len_alias_8(x, n, v, w) { const o = [-0]; const q = o, p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
function a_for_alias_8(x, n, v, w) { const o = [-0]; const q = o, p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); }
const a_while_pops_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); })[0];
const a_of_pops_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); })[0];
function a_len_stack_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_for_stack_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_for_shrinks_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
function a_while_shrinks_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); }
class C_len_reads_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); } } const a_len_reads_8 = (...r) => new C_len_reads_8().m(...r);
class C_for_reads_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); } } const a_for_reads_8 = (...r) => new C_for_reads_8().m(...r);
function a_while_over_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); }
function a_of_over_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[0] = w; i++; } return show([o, s, o.length, p]); }
function a_of_update_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[i] = o[i] * 2; i++; } return show([o, s, o.length, p]); }
function a_down_update_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); }
class C_len_after_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); } } const a_len_after_8 = (...r) => new C_len_after_8().m(...r);
class C_for_after_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); } } const a_for_after_8 = (...r) => new C_for_after_8().m(...r);
function a_len_calls_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
function a_for_calls_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
class C_len_given_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); } } const a_len_given_8 = (...r) => new C_len_given_8().m(...r);
class C_for_given_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); } } const a_for_given_8 = (...r) => new C_for_given_8().m(...r);
const a_down_sum_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += v; o.push(s); } return show([o, s, o.length, p]); })[0];
const a_len_sum_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); })[0];
function a_down_max_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
function a_len_max_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
function* G_while_left_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === n - 2) break; i++; } yield show([o, s, o.length, p]); } const a_while_left_8 = (...r) => [...G_while_left_8(...r)][0];
function* G_of_left_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === n - 2) break; i++; } yield show([o, s, o.length, p]); } const a_of_left_8 = (...r) => [...G_of_left_8(...r)][0];
function* G_while_ints_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i); i++; } yield show([o, s, o.length, p]); } const a_while_ints_8 = (...r) => [...G_while_ints_8(...r)][0];
function* G_of_ints_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i); i++; } yield show([o, s, o.length, p]); } const a_of_ints_8 = (...r) => [...G_of_ints_8(...r)][0];
function* G_for_doubles_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i * 0.5); } yield show([o, s, o.length, p]); } const a_for_doubles_8 = (...r) => [...G_for_doubles_8(...r)][0];
function* G_while_doubles_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i * 0.5); i++; } yield show([o, s, o.length, p]); } const a_while_doubles_8 = (...r) => [...G_while_doubles_8(...r)][0];
function a_of_joined_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v + ""); i++; } return show([o, s, o.length, p]); }
function a_down_joined_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v + ""); } return show([o, s, o.length, p]); }
const a_while_made_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push([v]); i++; } return show([o, s, o.length, p]); })[0];
const a_of_made_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push([v]); i++; } return show([o, s, o.length, p]); })[0];
function a_len_inner_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function a_for_inner_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function a_while_rows_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); }
function a_of_rows_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); }
function a_while_self_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); }
function a_of_self_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i < 3) o.push(o.length); else o.push(v); i++; } return show([o, s, o.length, p]); }
const a_while_late_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); })[0];
const a_of_late_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); })[0];
function* G_down_odd_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i % 4 === 3 ? w : v); } yield show([o, s, o.length, p]); } const a_down_odd_8 = (...r) => [...G_down_odd_8(...r)][0];
function* G_len_odd_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i % 4 === 3 ? w : v); } yield show([o, s, o.length, p]); } const a_len_odd_8 = (...r) => [...G_len_odd_8(...r)][0];
function a_len_moves_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
function a_for_moves_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
class C_len_named_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); } } const a_len_named_8 = (...r) => new C_len_named_8().m(...r);
class C_for_named_8 { m(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); } } const a_for_named_8 = (...r) => new C_for_named_8().m(...r);
const a_of_spread_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); })[0];
const a_down_spread_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(...[v, w]); } return show([o, s, o.length, p]); })[0];
function a_while_none_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(); i++; } return show([o, s, o.length, p]); }
function a_of_none_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(); i++; } return show([o, s, o.length, p]); }
function a_down_two_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_len_two_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v, w); } return show([o, s, o.length, p]); }
const a_while_call_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; while (i < n) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); })[0];
const a_of_call_8 = (x, n, v, w) => [0].map(() => { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); })[0];
function a_of_throws_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; let i = 0; for (const e of x) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); }
function a_down_throws_8(x, n, v, w) { const o = [-0]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
class C_len_push_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); } return show([o, s, o.length, p]); } } const a_len_push_9 = (...r) => new C_len_push_9().m(...r);
class C_for_push_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); } return show([o, s, o.length, p]); } } const a_for_push_9 = (...r) => new C_for_push_9().m(...r);
class C_for_length_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = v; } return show([o, s, o.length, p]); } } const a_for_length_9 = (...r) => new C_for_length_9().m(...r);
class C_while_length_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = v; i++; } return show([o, s, o.length, p]); } } const a_while_length_9 = (...r) => new C_while_length_9().m(...r);
function a_down_element_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); }
function a_len_element_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(x[i % x.length]); } return show([o, s, o.length, p]); }
function a_while_own_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); }
function a_of_own_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = x[i % x.length]; i++; } return show([o, s, o.length, p]); }
class C_for_prefix_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); } } const a_for_prefix_9 = (...r) => new C_for_prefix_9().m(...r);
class C_while_prefix_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[o.length - 1] + v); i++; } return show([o, s, o.length, p]); } } const a_while_prefix_9 = (...r) => new C_while_prefix_9().m(...r);
const a_for_behind_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); })[0];
const a_while_behind_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(o[i] + v); i++; } return show([o, s, o.length, p]); })[0];
function* G_of_twice_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o.push(w); i++; } yield show([o, s, o.length, p]); } const a_of_twice_9 = (...r) => [...G_of_twice_9(...r)][0];
function* G_down_twice_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o.push(w); } yield show([o, s, o.length, p]); } const a_down_twice_9 = (...r) => [...G_down_twice_9(...r)][0];
function* G_len_both_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[o.length] = w; } yield show([o, s, o.length, p]); } const a_len_both_9 = (...r) => [...G_len_both_9(...r)][0];
function* G_for_both_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[o.length] = w; } yield show([o, s, o.length, p]); } const a_for_both_9 = (...r) => [...G_for_both_9(...r)][0];
function* G_len_cond_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i % 3) o.push(v); } yield show([o, s, o.length, p]); } const a_len_cond_9 = (...r) => [...G_len_cond_9(...r)][0];
function* G_for_cond_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i % 3) o.push(v); } yield show([o, s, o.length, p]); } const a_for_cond_9 = (...r) => [...G_for_cond_9(...r)][0];
function a_for_either_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_while_either_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { if (i & 1) o.push(v); else o.push(w); i++; } return show([o, s, o.length, p]); }
function* G_for_answer_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += o.push(v); } yield show([o, s, o.length, p]); } const a_for_answer_9 = (...r) => [...G_for_answer_9(...r)][0];
function* G_while_answer_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { s += o.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_answer_9 = (...r) => [...G_while_answer_9(...r)][0];
class C_down_answers_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); } } const a_down_answers_9 = (...r) => new C_down_answers_9().m(...r);
class C_len_answers_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s = o.push(o.push(v)); } return show([o, s, o.length, p]); } } const a_len_answers_9 = (...r) => new C_len_answers_9().m(...r);
function a_of_lists_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); }
function a_down_lists_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
function* G_of_alias_9(x, n, v, w) { const o = [NaN]; const q = o, p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); q.push(w); i++; } yield show([o, s, o.length, p]); } const a_of_alias_9 = (...r) => [...G_of_alias_9(...r)][0];
function* G_down_alias_9(x, n, v, w) { const o = [NaN]; const q = o, p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); q.push(w); } yield show([o, s, o.length, p]); } const a_down_alias_9 = (...r) => [...G_down_alias_9(...r)][0];
function a_len_pops_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function a_for_pops_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function a_of_stack_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_stack_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_down_shrinks_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
function a_len_shrinks_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === 4) o.length = 2; } return show([o, s, o.length, p]); }
const a_of_reads_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); })[0];
const a_down_reads_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); })[0];
function a_len_over_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function a_for_over_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[0] = w; } return show([o, s, o.length, p]); }
function* G_for_update_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o[i] = o[i] * 2; } yield show([o, s, o.length, p]); } const a_for_update_9 = (...r) => [...G_for_update_9(...r)][0];
function* G_while_update_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o[i] = o[i] * 2; i++; } yield show([o, s, o.length, p]); } const a_while_update_9 = (...r) => [...G_while_update_9(...r)][0];
const a_of_after_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); })[0];
const a_down_after_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); })[0];
function a_of_calls_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); }
function a_down_calls_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
const a_of_given_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); })[0];
const a_down_given_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(f2(o, i)); } return show([o, s, o.length, p]); })[0];
function a_while_sum_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); }
function a_of_sum_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { s += v; o.push(s); i++; } return show([o, s, o.length, p]); }
function a_while_max_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); }
function a_of_max_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(Math.max(o[o.length - 1], v)); i++; } return show([o, s, o.length, p]); }
class C_len_left_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); } } const a_len_left_9 = (...r) => new C_len_left_9().m(...r);
class C_for_left_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); } } const a_for_left_9 = (...r) => new C_for_left_9().m(...r);
function* G_len_goes_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i === 3) continue; o.push(v); } yield show([o, s, o.length, p]); } const a_len_goes_9 = (...r) => [...G_len_goes_9(...r)][0];
function* G_for_goes_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i === 3) continue; o.push(v); } yield show([o, s, o.length, p]); } const a_for_goes_9 = (...r) => [...G_for_goes_9(...r)][0];
class C_len_ints_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i); } return show([o, s, o.length, p]); } } const a_len_ints_9 = (...r) => new C_len_ints_9().m(...r);
class C_for_ints_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i); } return show([o, s, o.length, p]); } } const a_for_ints_9 = (...r) => new C_for_ints_9().m(...r);
class C_down_doubles_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i * 0.5); } return show([o, s, o.length, p]); } } const a_down_doubles_9 = (...r) => new C_down_doubles_9().m(...r);
class C_len_doubles_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i * 0.5); } return show([o, s, o.length, p]); } } const a_len_doubles_9 = (...r) => new C_len_doubles_9().m(...r);
function* G_for_joined_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v + ""); } yield show([o, s, o.length, p]); } const a_for_joined_9 = (...r) => [...G_for_joined_9(...r)][0];
function* G_while_joined_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v + ""); i++; } yield show([o, s, o.length, p]); } const a_while_joined_9 = (...r) => [...G_while_joined_9(...r)][0];
function a_len_made_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push([v]); } return show([o, s, o.length, p]); }
function a_for_made_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push([v]); } return show([o, s, o.length, p]); }
function a_of_inner_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { for (let j = 0; j < 3; j++) o.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_inner_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { for (let j = 0; j < 3; j++) o.push(v); } return show([o, s, o.length, p]); }
function* G_len_rows_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } yield show([o, s, o.length, p]); } const a_len_rows_9 = (...r) => [...G_len_rows_9(...r)][0];
function* G_for_rows_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } yield show([o, s, o.length, p]); } const a_for_rows_9 = (...r) => [...G_for_rows_9(...r)][0];
function a_len_self_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
function a_for_self_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { if (i < 3) o.push(o.length); else o.push(v); } return show([o, s, o.length, p]); }
function a_len_late_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
function a_for_late_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
class C_while_odd_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); } } const a_while_odd_9 = (...r) => new C_while_odd_9().m(...r);
class C_of_odd_9 { m(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i % 4 === 3 ? w : v); i++; } return show([o, s, o.length, p]); } } const a_of_odd_9 = (...r) => new C_of_odd_9().m(...r);
function a_of_moves_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } return show([o, s, o.length, p]); }
function a_down_moves_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } return show([o, s, o.length, p]); }
const a_of_named_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_down_named_9 = (x, n, v, w) => [0].map(() => { const o = [NaN]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const m = o; m.push(v); } return show([o, s, o.length, p]); })[0];
function a_for_spread_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
function a_while_spread_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(...[v, w]); i++; } return show([o, s, o.length, p]); }
function* G_len_none_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(); } yield show([o, s, o.length, p]); } const a_len_none_9 = (...r) => [...G_len_none_9(...r)][0];
function* G_for_none_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(); } yield show([o, s, o.length, p]); } const a_for_none_9 = (...r) => [...G_for_none_9(...r)][0];
function a_while_two_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v, w); i++; } return show([o, s, o.length, p]); }
function a_of_two_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v, w); i++; } return show([o, s, o.length, p]); }
function a_len_call_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function a_for_call_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function a_for_throws_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; for (let i = 0; i < n; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
function a_while_throws_9(x, n, v, w) { const o = [NaN]; const p = []; let s = 0; let i = 0; while (i < n) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } i++; } return show([o, s, o.length, p]); }
const a_of_push_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); i++; } return show([o, s, o.length, p]); })[0];
const a_down_push_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); } return show([o, s, o.length, p]); })[0];
const a_down_length_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = v; } return show([o, s, o.length, p]); })[0];
const a_len_length_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = v; } return show([o, s, o.length, p]); })[0];
function a_while_element_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); }
function a_of_element_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(x[i % x.length]); i++; } return show([o, s, o.length, p]); }
function a_len_own_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
function a_for_own_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o[o.length] = x[i % x.length]; } return show([o, s, o.length, p]); }
const a_down_prefix_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); })[0];
const a_len_prefix_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[o.length - 1] + v); } return show([o, s, o.length, p]); })[0];
function a_down_behind_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
function a_len_behind_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(o[i] + v); } return show([o, s, o.length, p]); }
class C_for_twice_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); o.push(w); } return show([o, s, o.length, p]); } } const a_for_twice_10 = (...r) => new C_for_twice_10().m(...r);
class C_while_twice_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); o.push(w); i++; } return show([o, s, o.length, p]); } } const a_while_twice_10 = (...r) => new C_while_twice_10().m(...r);
class C_of_both_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[o.length] = w; i++; } return show([o, s, o.length, p]); } } const a_of_both_10 = (...r) => new C_of_both_10().m(...r);
class C_down_both_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[o.length] = w; } return show([o, s, o.length, p]); } } const a_down_both_10 = (...r) => new C_down_both_10().m(...r);
class C_of_cond_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i % 3) o.push(v); i++; } return show([o, s, o.length, p]); } } const a_of_cond_10 = (...r) => new C_of_cond_10().m(...r);
class C_down_cond_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i % 3) o.push(v); } return show([o, s, o.length, p]); } } const a_down_cond_10 = (...r) => new C_down_cond_10().m(...r);
function a_down_either_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
function a_len_either_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { if (i & 1) o.push(v); else o.push(w); } return show([o, s, o.length, p]); }
class C_down_answer_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { s += o.push(v); } return show([o, s, o.length, p]); } } const a_down_answer_10 = (...r) => new C_down_answer_10().m(...r);
class C_len_answer_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += o.push(v); } return show([o, s, o.length, p]); } } const a_len_answer_10 = (...r) => new C_len_answer_10().m(...r);
const a_while_answers_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); })[0];
const a_of_answers_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { s = o.push(o.push(v)); i++; } return show([o, s, o.length, p]); })[0];
function a_for_lists_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); p.push(w); s += p.length; } return show([o, s, o.length, p]); }
function a_while_lists_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); p.push(w); s += p.length; i++; } return show([o, s, o.length, p]); }
class C_for_alias_10 { m(x, n, v, w) { const o = [undefined]; const q = o, p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); q.push(w); } return show([o, s, o.length, p]); } } const a_for_alias_10 = (...r) => new C_for_alias_10().m(...r);
class C_while_alias_10 { m(x, n, v, w) { const o = [undefined]; const q = o, p = []; let s = 0; let i = 0; while (i < n) { o.push(v); q.push(w); i++; } return show([o, s, o.length, p]); } } const a_while_alias_10 = (...r) => new C_while_alias_10().m(...r);
function a_of_pops_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i % 5 === 4) o.pop(); i++; } return show([o, s, o.length, p]); }
function a_down_pops_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i % 5 === 4) o.pop(); } return show([o, s, o.length, p]); }
function a_for_stack_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { while (o.length > 3) s += o.pop() | 0; o.push(v); } return show([o, s, o.length, p]); }
function a_while_stack_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { while (o.length > 3) s += o.pop() | 0; o.push(v); i++; } return show([o, s, o.length, p]); }
function a_while_shrinks_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); }
function a_of_shrinks_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === 4) o.length = 2; i++; } return show([o, s, o.length, p]); }
function a_for_reads_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); } return show([o, s, o.length, p]); }
function a_while_reads_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += o.length + (o[i >> 1] === v ? 1 : 0); i++; } return show([o, s, o.length, p]); }
function* G_of_over_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); o[0] = w; i++; } yield show([o, s, o.length, p]); } const a_of_over_10 = (...r) => [...G_of_over_10(...r)][0];
function* G_down_over_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[0] = w; } yield show([o, s, o.length, p]); } const a_down_over_10 = (...r) => [...G_down_over_10(...r)][0];
class C_down_update_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); } } const a_down_update_10 = (...r) => new C_down_update_10().m(...r);
class C_len_update_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v); o[i] = o[i] * 2; } return show([o, s, o.length, p]); } } const a_len_update_10 = (...r) => new C_len_update_10().m(...r);
function a_for_after_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; } return show([o, s, o.length, p]); }
function a_while_after_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s = s * 31 % 1009 + x[i % x.length]; i++; } return show([o, s, o.length, p]); }
function a_for_calls_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += f2(o, i); } return show([o, s, o.length, p]); }
function a_while_calls_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); s += f2(o, i); i++; } return show([o, s, o.length, p]); }
function a_for_given_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(f2(o, i)); } return show([o, s, o.length, p]); }
function a_while_given_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(f2(o, i)); i++; } return show([o, s, o.length, p]); }
function a_len_sum_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function a_for_sum_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { s += v; o.push(s); } return show([o, s, o.length, p]); }
function a_len_max_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
function a_for_max_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(Math.max(o[o.length - 1], v)); } return show([o, s, o.length, p]); }
const a_of_left_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(v); if (i === n - 2) break; i++; } return show([o, s, o.length, p]); })[0];
const a_down_left_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v); if (i === n - 2) break; } return show([o, s, o.length, p]); })[0];
class C_down_goes_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i === 3) continue; o.push(v); } return show([o, s, o.length, p]); } } const a_down_goes_10 = (...r) => new C_down_goes_10().m(...r);
const a_of_ints_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i); i++; } return show([o, s, o.length, p]); })[0];
const a_down_ints_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(i); } return show([o, s, o.length, p]); })[0];
const a_while_doubles_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); })[0];
const a_of_doubles_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(i * 0.5); i++; } return show([o, s, o.length, p]); })[0];
class C_down_joined_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(v + ""); } return show([o, s, o.length, p]); } } const a_down_joined_10 = (...r) => new C_down_joined_10().m(...r);
class C_len_joined_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v + ""); } return show([o, s, o.length, p]); } } const a_len_joined_10 = (...r) => new C_len_joined_10().m(...r);
function a_of_made_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push([v]); i++; } return show([o, s, o.length, p]); }
function a_down_made_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push([v]); } return show([o, s, o.length, p]); }
function* G_for_inner_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) o.push(v); } yield show([o, s, o.length, p]); } const a_for_inner_10 = (...r) => [...G_for_inner_10(...r)][0];
function* G_while_inner_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { for (let j = 0; j < 3; j++) o.push(v); i++; } yield show([o, s, o.length, p]); } const a_while_inner_10 = (...r) => [...G_while_inner_10(...r)][0];
class C_of_rows_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); i++; } return show([o, s, o.length, p]); } } const a_of_rows_10 = (...r) => new C_of_rows_10().m(...r);
class C_down_rows_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { const r = []; for (let j = 0; j < 4; j++) r.push(v); o.push(r); } return show([o, s, o.length, p]); } } const a_down_rows_10 = (...r) => new C_down_rows_10().m(...r);
function* G_of_self_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { if (i < 3) o.push(o.length); else o.push(v); i++; } yield show([o, s, o.length, p]); } const a_of_self_10 = (...r) => [...G_of_self_10(...r)][0];
function* G_down_self_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { if (i < 3) o.push(o.length); else o.push(v); } yield show([o, s, o.length, p]); } const a_down_self_10 = (...r) => [...G_down_self_10(...r)][0];
function a_of_late_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); i++; } return show([o, s, o.length, p]); }
function a_down_late_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o[o.length] = (o.length & 1 ? o.push(w) : 0, v); } return show([o, s, o.length, p]); }
const a_len_odd_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); })[0];
const a_for_odd_10 = (x, n, v, w) => [0].map(() => { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(i % 4 === 3 ? w : v); } return show([o, s, o.length, p]); })[0];
function* G_for_moves_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } } yield show([o, s, o.length, p]); } const a_for_moves_10 = (...r) => [...G_for_moves_10(...r)][0];
function* G_while_moves_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { o.push(v); if (i === 5) { const t = o.slice(); t.push(w); s += t.length; } i++; } yield show([o, s, o.length, p]); } const a_while_moves_10 = (...r) => [...G_while_moves_10(...r)][0];
function a_for_named_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { const m = o; m.push(v); } return show([o, s, o.length, p]); }
function a_while_named_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; while (i < n) { const m = o; m.push(v); i++; } return show([o, s, o.length, p]); }
function a_down_spread_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
function a_len_spread_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(...[v, w]); } return show([o, s, o.length, p]); }
class C_of_none_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push(); i++; } return show([o, s, o.length, p]); } } const a_of_none_10 = (...r) => new C_of_none_10().m(...r);
class C_down_none_10 { m(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push(); } return show([o, s, o.length, p]); } } const a_down_none_10 = (...r) => new C_down_none_10().m(...r);
function a_len_two_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_for_two_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v, w); } return show([o, s, o.length, p]); }
function a_of_call_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; let i = 0; for (const e of x) { o.push.call(o, v); i++; } return show([o, s, o.length, p]); }
function a_down_call_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { o.push.call(o, v); } return show([o, s, o.length, p]); }
function a_down_throws_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = n - 1; i >= 0; i--) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
function a_len_throws_10(x, n, v, w) { const o = [undefined]; const p = []; let s = 0; for (let i = 0; i < x.length; i++) { try { o.push(v); if (i === 4) throw 1; } catch { s++; } } return show([o, s, o.length, p]); }
run("of_push_0", a_of_push_0);
run("down_push_0", a_down_push_0);
run("down_length_0", a_down_length_0);
run("len_length_0", a_len_length_0);
run("while_element_0", a_while_element_0);
run("of_element_0", a_of_element_0);
run("len_own_0", a_len_own_0);
run("for_own_0", a_for_own_0);
run("down_prefix_0", a_down_prefix_0);
run("len_prefix_0", a_len_prefix_0);
run("down_behind_0", a_down_behind_0);
run("len_behind_0", a_len_behind_0);
run("for_twice_0", a_for_twice_0);
run("while_twice_0", a_while_twice_0);
run("of_both_0", a_of_both_0);
run("down_both_0", a_down_both_0);
run("of_cond_0", a_of_cond_0);
run("down_cond_0", a_down_cond_0);
run("down_either_0", a_down_either_0);
run("len_either_0", a_len_either_0);
run("down_answer_0", a_down_answer_0);
run("len_answer_0", a_len_answer_0);
run("while_answers_0", a_while_answers_0);
run("of_answers_0", a_of_answers_0);
run("for_lists_0", a_for_lists_0);
run("while_lists_0", a_while_lists_0);
run("for_alias_0", a_for_alias_0);
run("while_alias_0", a_while_alias_0);
run("of_pops_0", a_of_pops_0);
run("down_pops_0", a_down_pops_0);
run("for_stack_0", a_for_stack_0);
run("while_stack_0", a_while_stack_0);
run("while_shrinks_0", a_while_shrinks_0);
run("of_shrinks_0", a_of_shrinks_0);
run("for_reads_0", a_for_reads_0);
run("while_reads_0", a_while_reads_0);
run("of_over_0", a_of_over_0);
run("down_over_0", a_down_over_0);
run("down_update_0", a_down_update_0);
run("len_update_0", a_len_update_0);
run("for_after_0", a_for_after_0);
run("while_after_0", a_while_after_0);
run("for_calls_0", a_for_calls_0);
run("while_calls_0", a_while_calls_0);
run("for_given_0", a_for_given_0);
run("while_given_0", a_while_given_0);
run("len_sum_0", a_len_sum_0);
run("for_sum_0", a_for_sum_0);
run("len_max_0", a_len_max_0);
run("for_max_0", a_for_max_0);
run("of_left_0", a_of_left_0);
run("down_left_0", a_down_left_0);
run("down_goes_0", a_down_goes_0);
run("of_ints_0", a_of_ints_0);
run("down_ints_0", a_down_ints_0);
run("while_doubles_0", a_while_doubles_0);
run("of_doubles_0", a_of_doubles_0);
run("down_joined_0", a_down_joined_0);
run("len_joined_0", a_len_joined_0);
run("of_made_0", a_of_made_0);
run("down_made_0", a_down_made_0);
run("for_inner_0", a_for_inner_0);
run("while_inner_0", a_while_inner_0);
run("of_rows_0", a_of_rows_0);
run("down_rows_0", a_down_rows_0);
run("of_self_0", a_of_self_0);
run("down_self_0", a_down_self_0);
run("of_late_0", a_of_late_0);
run("down_late_0", a_down_late_0);
run("len_odd_0", a_len_odd_0);
run("for_odd_0", a_for_odd_0);
run("for_moves_0", a_for_moves_0);
run("while_moves_0", a_while_moves_0);
run("for_named_0", a_for_named_0);
run("while_named_0", a_while_named_0);
run("down_spread_0", a_down_spread_0);
run("len_spread_0", a_len_spread_0);
run("of_none_0", a_of_none_0);
run("down_none_0", a_down_none_0);
run("len_two_0", a_len_two_0);
run("for_two_0", a_for_two_0);
run("of_call_0", a_of_call_0);
run("down_call_0", a_down_call_0);
run("down_throws_0", a_down_throws_0);
run("len_throws_0", a_len_throws_0);
run("for_push_1", a_for_push_1);
run("while_push_1", a_while_push_1);
run("while_length_1", a_while_length_1);
run("of_length_1", a_of_length_1);
run("len_element_1", a_len_element_1);
run("for_element_1", a_for_element_1);
run("of_own_1", a_of_own_1);
run("down_own_1", a_down_own_1);
run("while_prefix_1", a_while_prefix_1);
run("of_prefix_1", a_of_prefix_1);
run("while_behind_1", a_while_behind_1);
run("of_behind_1", a_of_behind_1);
run("down_twice_1", a_down_twice_1);
run("len_twice_1", a_len_twice_1);
run("for_both_1", a_for_both_1);
run("while_both_1", a_while_both_1);
run("for_cond_1", a_for_cond_1);
run("while_cond_1", a_while_cond_1);
run("while_either_1", a_while_either_1);
run("of_either_1", a_of_either_1);
run("while_answer_1", a_while_answer_1);
run("of_answer_1", a_of_answer_1);
run("len_answers_1", a_len_answers_1);
run("for_answers_1", a_for_answers_1);
run("down_lists_1", a_down_lists_1);
run("len_lists_1", a_len_lists_1);
run("down_alias_1", a_down_alias_1);
run("len_alias_1", a_len_alias_1);
run("for_pops_1", a_for_pops_1);
run("while_pops_1", a_while_pops_1);
run("down_stack_1", a_down_stack_1);
run("len_stack_1", a_len_stack_1);
run("len_shrinks_1", a_len_shrinks_1);
run("for_shrinks_1", a_for_shrinks_1);
run("down_reads_1", a_down_reads_1);
run("len_reads_1", a_len_reads_1);
run("for_over_1", a_for_over_1);
run("while_over_1", a_while_over_1);
run("while_update_1", a_while_update_1);
run("of_update_1", a_of_update_1);
run("down_after_1", a_down_after_1);
run("len_after_1", a_len_after_1);
run("down_calls_1", a_down_calls_1);
run("len_calls_1", a_len_calls_1);
run("down_given_1", a_down_given_1);
run("len_given_1", a_len_given_1);
run("of_sum_1", a_of_sum_1);
run("down_sum_1", a_down_sum_1);
run("of_max_1", a_of_max_1);
run("down_max_1", a_down_max_1);
run("for_left_1", a_for_left_1);
run("while_left_1", a_while_left_1);
run("for_goes_1", a_for_goes_1);
run("for_ints_1", a_for_ints_1);
run("while_ints_1", a_while_ints_1);
run("len_doubles_1", a_len_doubles_1);
run("for_doubles_1", a_for_doubles_1);
run("while_joined_1", a_while_joined_1);
run("of_joined_1", a_of_joined_1);
run("for_made_1", a_for_made_1);
run("while_made_1", a_while_made_1);
run("down_inner_1", a_down_inner_1);
run("len_inner_1", a_len_inner_1);
run("for_rows_1", a_for_rows_1);
run("while_rows_1", a_while_rows_1);
run("for_self_1", a_for_self_1);
run("while_self_1", a_while_self_1);
run("for_late_1", a_for_late_1);
run("while_late_1", a_while_late_1);
run("of_odd_1", a_of_odd_1);
run("down_odd_1", a_down_odd_1);
run("down_moves_1", a_down_moves_1);
run("len_moves_1", a_len_moves_1);
run("down_named_1", a_down_named_1);
run("len_named_1", a_len_named_1);
run("while_spread_1", a_while_spread_1);
run("of_spread_1", a_of_spread_1);
run("for_none_1", a_for_none_1);
run("while_none_1", a_while_none_1);
run("of_two_1", a_of_two_1);
run("down_two_1", a_down_two_1);
run("for_call_1", a_for_call_1);
run("while_call_1", a_while_call_1);
run("while_throws_1", a_while_throws_1);
run("of_throws_1", a_of_throws_1);
run("down_push_2", a_down_push_2);
run("len_push_2", a_len_push_2);
run("len_length_2", a_len_length_2);
run("for_length_2", a_for_length_2);
run("of_element_2", a_of_element_2);
run("down_element_2", a_down_element_2);
run("for_own_2", a_for_own_2);
run("while_own_2", a_while_own_2);
run("len_prefix_2", a_len_prefix_2);
run("for_prefix_2", a_for_prefix_2);
run("len_behind_2", a_len_behind_2);
run("for_behind_2", a_for_behind_2);
run("while_twice_2", a_while_twice_2);
run("of_twice_2", a_of_twice_2);
run("down_both_2", a_down_both_2);
run("len_both_2", a_len_both_2);
run("down_cond_2", a_down_cond_2);
run("len_cond_2", a_len_cond_2);
run("len_either_2", a_len_either_2);
run("for_either_2", a_for_either_2);
run("len_answer_2", a_len_answer_2);
run("for_answer_2", a_for_answer_2);
run("of_answers_2", a_of_answers_2);
run("down_answers_2", a_down_answers_2);
run("while_lists_2", a_while_lists_2);
run("of_lists_2", a_of_lists_2);
run("while_alias_2", a_while_alias_2);
run("of_alias_2", a_of_alias_2);
run("down_pops_2", a_down_pops_2);
run("len_pops_2", a_len_pops_2);
run("while_stack_2", a_while_stack_2);
run("of_stack_2", a_of_stack_2);
run("of_shrinks_2", a_of_shrinks_2);
run("down_shrinks_2", a_down_shrinks_2);
run("while_reads_2", a_while_reads_2);
run("of_reads_2", a_of_reads_2);
run("down_over_2", a_down_over_2);
run("len_over_2", a_len_over_2);
run("len_update_2", a_len_update_2);
run("for_update_2", a_for_update_2);
run("while_after_2", a_while_after_2);
run("of_after_2", a_of_after_2);
run("while_calls_2", a_while_calls_2);
run("of_calls_2", a_of_calls_2);
run("while_given_2", a_while_given_2);
run("of_given_2", a_of_given_2);
run("for_sum_2", a_for_sum_2);
run("while_sum_2", a_while_sum_2);
run("for_max_2", a_for_max_2);
run("while_max_2", a_while_max_2);
run("down_left_2", a_down_left_2);
run("len_left_2", a_len_left_2);
run("down_goes_2", a_down_goes_2);
run("len_goes_2", a_len_goes_2);
run("down_ints_2", a_down_ints_2);
run("len_ints_2", a_len_ints_2);
run("of_doubles_2", a_of_doubles_2);
run("down_doubles_2", a_down_doubles_2);
run("len_joined_2", a_len_joined_2);
run("for_joined_2", a_for_joined_2);
run("down_made_2", a_down_made_2);
run("len_made_2", a_len_made_2);
run("while_inner_2", a_while_inner_2);
run("of_inner_2", a_of_inner_2);
run("down_rows_2", a_down_rows_2);
run("len_rows_2", a_len_rows_2);
run("down_self_2", a_down_self_2);
run("len_self_2", a_len_self_2);
run("down_late_2", a_down_late_2);
run("len_late_2", a_len_late_2);
run("for_odd_2", a_for_odd_2);
run("while_odd_2", a_while_odd_2);
run("while_moves_2", a_while_moves_2);
run("of_moves_2", a_of_moves_2);
run("while_named_2", a_while_named_2);
run("of_named_2", a_of_named_2);
run("len_spread_2", a_len_spread_2);
run("for_spread_2", a_for_spread_2);
run("down_none_2", a_down_none_2);
run("len_none_2", a_len_none_2);
run("for_two_2", a_for_two_2);
run("while_two_2", a_while_two_2);
run("down_call_2", a_down_call_2);
run("len_call_2", a_len_call_2);
run("len_throws_2", a_len_throws_2);
run("for_throws_2", a_for_throws_2);
run("while_push_3", a_while_push_3);
run("of_push_3", a_of_push_3);
run("of_length_3", a_of_length_3);
run("down_length_3", a_down_length_3);
run("for_element_3", a_for_element_3);
run("while_element_3", a_while_element_3);
run("down_own_3", a_down_own_3);
run("len_own_3", a_len_own_3);
run("of_prefix_3", a_of_prefix_3);
run("down_prefix_3", a_down_prefix_3);
run("of_behind_3", a_of_behind_3);
run("down_behind_3", a_down_behind_3);
run("len_twice_3", a_len_twice_3);
run("for_twice_3", a_for_twice_3);
run("while_both_3", a_while_both_3);
run("of_both_3", a_of_both_3);
run("while_cond_3", a_while_cond_3);
run("of_cond_3", a_of_cond_3);
run("of_either_3", a_of_either_3);
run("down_either_3", a_down_either_3);
run("of_answer_3", a_of_answer_3);
run("down_answer_3", a_down_answer_3);
run("for_answers_3", a_for_answers_3);
run("while_answers_3", a_while_answers_3);
run("len_lists_3", a_len_lists_3);
run("for_lists_3", a_for_lists_3);
run("len_alias_3", a_len_alias_3);
run("for_alias_3", a_for_alias_3);
run("while_pops_3", a_while_pops_3);
run("of_pops_3", a_of_pops_3);
run("len_stack_3", a_len_stack_3);
run("for_stack_3", a_for_stack_3);
run("for_shrinks_3", a_for_shrinks_3);
run("while_shrinks_3", a_while_shrinks_3);
run("len_reads_3", a_len_reads_3);
run("for_reads_3", a_for_reads_3);
run("while_over_3", a_while_over_3);
run("of_over_3", a_of_over_3);
run("of_update_3", a_of_update_3);
run("down_update_3", a_down_update_3);
run("len_after_3", a_len_after_3);
run("for_after_3", a_for_after_3);
run("len_calls_3", a_len_calls_3);
run("for_calls_3", a_for_calls_3);
run("len_given_3", a_len_given_3);
run("for_given_3", a_for_given_3);
run("down_sum_3", a_down_sum_3);
run("len_sum_3", a_len_sum_3);
run("down_max_3", a_down_max_3);
run("len_max_3", a_len_max_3);
run("while_left_3", a_while_left_3);
run("of_left_3", a_of_left_3);
run("while_ints_3", a_while_ints_3);
run("of_ints_3", a_of_ints_3);
run("for_doubles_3", a_for_doubles_3);
run("while_doubles_3", a_while_doubles_3);
run("of_joined_3", a_of_joined_3);
run("down_joined_3", a_down_joined_3);
run("while_made_3", a_while_made_3);
run("of_made_3", a_of_made_3);
run("len_inner_3", a_len_inner_3);
run("for_inner_3", a_for_inner_3);
run("while_rows_3", a_while_rows_3);
run("of_rows_3", a_of_rows_3);
run("while_self_3", a_while_self_3);
run("of_self_3", a_of_self_3);
run("while_late_3", a_while_late_3);
run("of_late_3", a_of_late_3);
run("down_odd_3", a_down_odd_3);
run("len_odd_3", a_len_odd_3);
run("len_moves_3", a_len_moves_3);
run("for_moves_3", a_for_moves_3);
run("len_named_3", a_len_named_3);
run("for_named_3", a_for_named_3);
run("of_spread_3", a_of_spread_3);
run("down_spread_3", a_down_spread_3);
run("while_none_3", a_while_none_3);
run("of_none_3", a_of_none_3);
run("down_two_3", a_down_two_3);
run("len_two_3", a_len_two_3);
run("while_call_3", a_while_call_3);
run("of_call_3", a_of_call_3);
run("of_throws_3", a_of_throws_3);
run("down_throws_3", a_down_throws_3);
run("len_push_4", a_len_push_4);
run("for_push_4", a_for_push_4);
run("for_length_4", a_for_length_4);
run("while_length_4", a_while_length_4);
run("down_element_4", a_down_element_4);
run("len_element_4", a_len_element_4);
run("while_own_4", a_while_own_4);
run("of_own_4", a_of_own_4);
run("for_prefix_4", a_for_prefix_4);
run("while_prefix_4", a_while_prefix_4);
run("for_behind_4", a_for_behind_4);
run("while_behind_4", a_while_behind_4);
run("of_twice_4", a_of_twice_4);
run("down_twice_4", a_down_twice_4);
run("len_both_4", a_len_both_4);
run("for_both_4", a_for_both_4);
run("len_cond_4", a_len_cond_4);
run("for_cond_4", a_for_cond_4);
run("for_either_4", a_for_either_4);
run("while_either_4", a_while_either_4);
run("for_answer_4", a_for_answer_4);
run("while_answer_4", a_while_answer_4);
run("down_answers_4", a_down_answers_4);
run("len_answers_4", a_len_answers_4);
run("of_lists_4", a_of_lists_4);
run("down_lists_4", a_down_lists_4);
run("of_alias_4", a_of_alias_4);
run("down_alias_4", a_down_alias_4);
run("len_pops_4", a_len_pops_4);
run("for_pops_4", a_for_pops_4);
run("of_stack_4", a_of_stack_4);
run("down_stack_4", a_down_stack_4);
run("down_shrinks_4", a_down_shrinks_4);
run("len_shrinks_4", a_len_shrinks_4);
run("of_reads_4", a_of_reads_4);
run("down_reads_4", a_down_reads_4);
run("len_over_4", a_len_over_4);
run("for_over_4", a_for_over_4);
run("for_update_4", a_for_update_4);
run("while_update_4", a_while_update_4);
run("of_after_4", a_of_after_4);
run("down_after_4", a_down_after_4);
run("of_calls_4", a_of_calls_4);
run("down_calls_4", a_down_calls_4);
run("of_given_4", a_of_given_4);
run("down_given_4", a_down_given_4);
run("while_sum_4", a_while_sum_4);
run("of_sum_4", a_of_sum_4);
run("while_max_4", a_while_max_4);
run("of_max_4", a_of_max_4);
run("len_left_4", a_len_left_4);
run("for_left_4", a_for_left_4);
run("len_goes_4", a_len_goes_4);
run("for_goes_4", a_for_goes_4);
run("len_ints_4", a_len_ints_4);
run("for_ints_4", a_for_ints_4);
run("down_doubles_4", a_down_doubles_4);
run("len_doubles_4", a_len_doubles_4);
run("for_joined_4", a_for_joined_4);
run("while_joined_4", a_while_joined_4);
run("len_made_4", a_len_made_4);
run("for_made_4", a_for_made_4);
run("of_inner_4", a_of_inner_4);
run("down_inner_4", a_down_inner_4);
run("len_rows_4", a_len_rows_4);
run("for_rows_4", a_for_rows_4);
run("len_self_4", a_len_self_4);
run("for_self_4", a_for_self_4);
run("len_late_4", a_len_late_4);
run("for_late_4", a_for_late_4);
run("while_odd_4", a_while_odd_4);
run("of_odd_4", a_of_odd_4);
run("of_moves_4", a_of_moves_4);
run("down_moves_4", a_down_moves_4);
run("of_named_4", a_of_named_4);
run("down_named_4", a_down_named_4);
run("for_spread_4", a_for_spread_4);
run("while_spread_4", a_while_spread_4);
run("len_none_4", a_len_none_4);
run("for_none_4", a_for_none_4);
run("while_two_4", a_while_two_4);
run("of_two_4", a_of_two_4);
run("len_call_4", a_len_call_4);
run("for_call_4", a_for_call_4);
run("for_throws_4", a_for_throws_4);
run("while_throws_4", a_while_throws_4);
run("of_push_5", a_of_push_5);
run("down_push_5", a_down_push_5);
run("down_length_5", a_down_length_5);
run("len_length_5", a_len_length_5);
run("while_element_5", a_while_element_5);
run("of_element_5", a_of_element_5);
run("len_own_5", a_len_own_5);
run("for_own_5", a_for_own_5);
run("down_prefix_5", a_down_prefix_5);
run("len_prefix_5", a_len_prefix_5);
run("down_behind_5", a_down_behind_5);
run("len_behind_5", a_len_behind_5);
run("for_twice_5", a_for_twice_5);
run("while_twice_5", a_while_twice_5);
run("of_both_5", a_of_both_5);
run("down_both_5", a_down_both_5);
run("of_cond_5", a_of_cond_5);
run("down_cond_5", a_down_cond_5);
run("down_either_5", a_down_either_5);
run("len_either_5", a_len_either_5);
run("down_answer_5", a_down_answer_5);
run("len_answer_5", a_len_answer_5);
run("while_answers_5", a_while_answers_5);
run("of_answers_5", a_of_answers_5);
run("for_lists_5", a_for_lists_5);
run("while_lists_5", a_while_lists_5);
run("for_alias_5", a_for_alias_5);
run("while_alias_5", a_while_alias_5);
run("of_pops_5", a_of_pops_5);
run("down_pops_5", a_down_pops_5);
run("for_stack_5", a_for_stack_5);
run("while_stack_5", a_while_stack_5);
run("while_shrinks_5", a_while_shrinks_5);
run("of_shrinks_5", a_of_shrinks_5);
run("for_reads_5", a_for_reads_5);
run("while_reads_5", a_while_reads_5);
run("of_over_5", a_of_over_5);
run("down_over_5", a_down_over_5);
run("down_update_5", a_down_update_5);
run("len_update_5", a_len_update_5);
run("for_after_5", a_for_after_5);
run("while_after_5", a_while_after_5);
run("for_calls_5", a_for_calls_5);
run("while_calls_5", a_while_calls_5);
run("for_given_5", a_for_given_5);
run("while_given_5", a_while_given_5);
run("len_sum_5", a_len_sum_5);
run("for_sum_5", a_for_sum_5);
run("len_max_5", a_len_max_5);
run("for_max_5", a_for_max_5);
run("of_left_5", a_of_left_5);
run("down_left_5", a_down_left_5);
run("down_goes_5", a_down_goes_5);
run("of_ints_5", a_of_ints_5);
run("down_ints_5", a_down_ints_5);
run("while_doubles_5", a_while_doubles_5);
run("of_doubles_5", a_of_doubles_5);
run("down_joined_5", a_down_joined_5);
run("len_joined_5", a_len_joined_5);
run("of_made_5", a_of_made_5);
run("down_made_5", a_down_made_5);
run("for_inner_5", a_for_inner_5);
run("while_inner_5", a_while_inner_5);
run("of_rows_5", a_of_rows_5);
run("down_rows_5", a_down_rows_5);
run("of_self_5", a_of_self_5);
run("down_self_5", a_down_self_5);
run("of_late_5", a_of_late_5);
run("down_late_5", a_down_late_5);
run("len_odd_5", a_len_odd_5);
run("for_odd_5", a_for_odd_5);
run("for_moves_5", a_for_moves_5);
run("while_moves_5", a_while_moves_5);
run("for_named_5", a_for_named_5);
run("while_named_5", a_while_named_5);
run("down_spread_5", a_down_spread_5);
run("len_spread_5", a_len_spread_5);
run("of_none_5", a_of_none_5);
run("down_none_5", a_down_none_5);
run("len_two_5", a_len_two_5);
run("for_two_5", a_for_two_5);
run("of_call_5", a_of_call_5);
run("down_call_5", a_down_call_5);
run("down_throws_5", a_down_throws_5);
run("len_throws_5", a_len_throws_5);
run("for_push_6", a_for_push_6);
run("while_push_6", a_while_push_6);
run("while_length_6", a_while_length_6);
run("of_length_6", a_of_length_6);
run("len_element_6", a_len_element_6);
run("for_element_6", a_for_element_6);
run("of_own_6", a_of_own_6);
run("down_own_6", a_down_own_6);
run("while_prefix_6", a_while_prefix_6);
run("of_prefix_6", a_of_prefix_6);
run("while_behind_6", a_while_behind_6);
run("of_behind_6", a_of_behind_6);
run("down_twice_6", a_down_twice_6);
run("len_twice_6", a_len_twice_6);
run("for_both_6", a_for_both_6);
run("while_both_6", a_while_both_6);
run("for_cond_6", a_for_cond_6);
run("while_cond_6", a_while_cond_6);
run("while_either_6", a_while_either_6);
run("of_either_6", a_of_either_6);
run("while_answer_6", a_while_answer_6);
run("of_answer_6", a_of_answer_6);
run("len_answers_6", a_len_answers_6);
run("for_answers_6", a_for_answers_6);
run("down_lists_6", a_down_lists_6);
run("len_lists_6", a_len_lists_6);
run("down_alias_6", a_down_alias_6);
run("len_alias_6", a_len_alias_6);
run("for_pops_6", a_for_pops_6);
run("while_pops_6", a_while_pops_6);
run("down_stack_6", a_down_stack_6);
run("len_stack_6", a_len_stack_6);
run("len_shrinks_6", a_len_shrinks_6);
run("for_shrinks_6", a_for_shrinks_6);
run("down_reads_6", a_down_reads_6);
run("len_reads_6", a_len_reads_6);
run("for_over_6", a_for_over_6);
run("while_over_6", a_while_over_6);
run("while_update_6", a_while_update_6);
run("of_update_6", a_of_update_6);
run("down_after_6", a_down_after_6);
run("len_after_6", a_len_after_6);
run("down_calls_6", a_down_calls_6);
run("len_calls_6", a_len_calls_6);
run("down_given_6", a_down_given_6);
run("len_given_6", a_len_given_6);
run("of_sum_6", a_of_sum_6);
run("down_sum_6", a_down_sum_6);
run("of_max_6", a_of_max_6);
run("down_max_6", a_down_max_6);
run("for_left_6", a_for_left_6);
run("while_left_6", a_while_left_6);
run("for_goes_6", a_for_goes_6);
run("for_ints_6", a_for_ints_6);
run("while_ints_6", a_while_ints_6);
run("len_doubles_6", a_len_doubles_6);
run("for_doubles_6", a_for_doubles_6);
run("while_joined_6", a_while_joined_6);
run("of_joined_6", a_of_joined_6);
run("for_made_6", a_for_made_6);
run("while_made_6", a_while_made_6);
run("down_inner_6", a_down_inner_6);
run("len_inner_6", a_len_inner_6);
run("for_rows_6", a_for_rows_6);
run("while_rows_6", a_while_rows_6);
run("for_self_6", a_for_self_6);
run("while_self_6", a_while_self_6);
run("for_late_6", a_for_late_6);
run("while_late_6", a_while_late_6);
run("of_odd_6", a_of_odd_6);
run("down_odd_6", a_down_odd_6);
run("down_moves_6", a_down_moves_6);
run("len_moves_6", a_len_moves_6);
run("down_named_6", a_down_named_6);
run("len_named_6", a_len_named_6);
run("while_spread_6", a_while_spread_6);
run("of_spread_6", a_of_spread_6);
run("for_none_6", a_for_none_6);
run("while_none_6", a_while_none_6);
run("of_two_6", a_of_two_6);
run("down_two_6", a_down_two_6);
run("for_call_6", a_for_call_6);
run("while_call_6", a_while_call_6);
run("while_throws_6", a_while_throws_6);
run("of_throws_6", a_of_throws_6);
run("down_push_7", a_down_push_7);
run("len_push_7", a_len_push_7);
run("len_length_7", a_len_length_7);
run("for_length_7", a_for_length_7);
run("of_element_7", a_of_element_7);
run("down_element_7", a_down_element_7);
run("for_own_7", a_for_own_7);
run("while_own_7", a_while_own_7);
run("len_prefix_7", a_len_prefix_7);
run("for_prefix_7", a_for_prefix_7);
run("len_behind_7", a_len_behind_7);
run("for_behind_7", a_for_behind_7);
run("while_twice_7", a_while_twice_7);
run("of_twice_7", a_of_twice_7);
run("down_both_7", a_down_both_7);
run("len_both_7", a_len_both_7);
run("down_cond_7", a_down_cond_7);
run("len_cond_7", a_len_cond_7);
run("len_either_7", a_len_either_7);
run("for_either_7", a_for_either_7);
run("len_answer_7", a_len_answer_7);
run("for_answer_7", a_for_answer_7);
run("of_answers_7", a_of_answers_7);
run("down_answers_7", a_down_answers_7);
run("while_lists_7", a_while_lists_7);
run("of_lists_7", a_of_lists_7);
run("while_alias_7", a_while_alias_7);
run("of_alias_7", a_of_alias_7);
run("down_pops_7", a_down_pops_7);
run("len_pops_7", a_len_pops_7);
run("while_stack_7", a_while_stack_7);
run("of_stack_7", a_of_stack_7);
run("of_shrinks_7", a_of_shrinks_7);
run("down_shrinks_7", a_down_shrinks_7);
run("while_reads_7", a_while_reads_7);
run("of_reads_7", a_of_reads_7);
run("down_over_7", a_down_over_7);
run("len_over_7", a_len_over_7);
run("len_update_7", a_len_update_7);
run("for_update_7", a_for_update_7);
run("while_after_7", a_while_after_7);
run("of_after_7", a_of_after_7);
run("while_calls_7", a_while_calls_7);
run("of_calls_7", a_of_calls_7);
run("while_given_7", a_while_given_7);
run("of_given_7", a_of_given_7);
run("for_sum_7", a_for_sum_7);
run("while_sum_7", a_while_sum_7);
run("for_max_7", a_for_max_7);
run("while_max_7", a_while_max_7);
run("down_left_7", a_down_left_7);
run("len_left_7", a_len_left_7);
run("down_goes_7", a_down_goes_7);
run("len_goes_7", a_len_goes_7);
run("down_ints_7", a_down_ints_7);
run("len_ints_7", a_len_ints_7);
run("of_doubles_7", a_of_doubles_7);
run("down_doubles_7", a_down_doubles_7);
run("len_joined_7", a_len_joined_7);
run("for_joined_7", a_for_joined_7);
run("down_made_7", a_down_made_7);
run("len_made_7", a_len_made_7);
run("while_inner_7", a_while_inner_7);
run("of_inner_7", a_of_inner_7);
run("down_rows_7", a_down_rows_7);
run("len_rows_7", a_len_rows_7);
run("down_self_7", a_down_self_7);
run("len_self_7", a_len_self_7);
run("down_late_7", a_down_late_7);
run("len_late_7", a_len_late_7);
run("for_odd_7", a_for_odd_7);
run("while_odd_7", a_while_odd_7);
run("while_moves_7", a_while_moves_7);
run("of_moves_7", a_of_moves_7);
run("while_named_7", a_while_named_7);
run("of_named_7", a_of_named_7);
run("len_spread_7", a_len_spread_7);
run("for_spread_7", a_for_spread_7);
run("down_none_7", a_down_none_7);
run("len_none_7", a_len_none_7);
run("for_two_7", a_for_two_7);
run("while_two_7", a_while_two_7);
run("down_call_7", a_down_call_7);
run("len_call_7", a_len_call_7);
run("len_throws_7", a_len_throws_7);
run("for_throws_7", a_for_throws_7);
run("while_push_8", a_while_push_8);
run("of_push_8", a_of_push_8);
run("of_length_8", a_of_length_8);
run("down_length_8", a_down_length_8);
run("for_element_8", a_for_element_8);
run("while_element_8", a_while_element_8);
run("down_own_8", a_down_own_8);
run("len_own_8", a_len_own_8);
run("of_prefix_8", a_of_prefix_8);
run("down_prefix_8", a_down_prefix_8);
run("of_behind_8", a_of_behind_8);
run("down_behind_8", a_down_behind_8);
run("len_twice_8", a_len_twice_8);
run("for_twice_8", a_for_twice_8);
run("while_both_8", a_while_both_8);
run("of_both_8", a_of_both_8);
run("while_cond_8", a_while_cond_8);
run("of_cond_8", a_of_cond_8);
run("of_either_8", a_of_either_8);
run("down_either_8", a_down_either_8);
run("of_answer_8", a_of_answer_8);
run("down_answer_8", a_down_answer_8);
run("for_answers_8", a_for_answers_8);
run("while_answers_8", a_while_answers_8);
run("len_lists_8", a_len_lists_8);
run("for_lists_8", a_for_lists_8);
run("len_alias_8", a_len_alias_8);
run("for_alias_8", a_for_alias_8);
run("while_pops_8", a_while_pops_8);
run("of_pops_8", a_of_pops_8);
run("len_stack_8", a_len_stack_8);
run("for_stack_8", a_for_stack_8);
run("for_shrinks_8", a_for_shrinks_8);
run("while_shrinks_8", a_while_shrinks_8);
run("len_reads_8", a_len_reads_8);
run("for_reads_8", a_for_reads_8);
run("while_over_8", a_while_over_8);
run("of_over_8", a_of_over_8);
run("of_update_8", a_of_update_8);
run("down_update_8", a_down_update_8);
run("len_after_8", a_len_after_8);
run("for_after_8", a_for_after_8);
run("len_calls_8", a_len_calls_8);
run("for_calls_8", a_for_calls_8);
run("len_given_8", a_len_given_8);
run("for_given_8", a_for_given_8);
run("down_sum_8", a_down_sum_8);
run("len_sum_8", a_len_sum_8);
run("down_max_8", a_down_max_8);
run("len_max_8", a_len_max_8);
run("while_left_8", a_while_left_8);
run("of_left_8", a_of_left_8);
run("while_ints_8", a_while_ints_8);
run("of_ints_8", a_of_ints_8);
run("for_doubles_8", a_for_doubles_8);
run("while_doubles_8", a_while_doubles_8);
run("of_joined_8", a_of_joined_8);
run("down_joined_8", a_down_joined_8);
run("while_made_8", a_while_made_8);
run("of_made_8", a_of_made_8);
run("len_inner_8", a_len_inner_8);
run("for_inner_8", a_for_inner_8);
run("while_rows_8", a_while_rows_8);
run("of_rows_8", a_of_rows_8);
run("while_self_8", a_while_self_8);
run("of_self_8", a_of_self_8);
run("while_late_8", a_while_late_8);
run("of_late_8", a_of_late_8);
run("down_odd_8", a_down_odd_8);
run("len_odd_8", a_len_odd_8);
run("len_moves_8", a_len_moves_8);
run("for_moves_8", a_for_moves_8);
run("len_named_8", a_len_named_8);
run("for_named_8", a_for_named_8);
run("of_spread_8", a_of_spread_8);
run("down_spread_8", a_down_spread_8);
run("while_none_8", a_while_none_8);
run("of_none_8", a_of_none_8);
run("down_two_8", a_down_two_8);
run("len_two_8", a_len_two_8);
run("while_call_8", a_while_call_8);
run("of_call_8", a_of_call_8);
run("of_throws_8", a_of_throws_8);
run("down_throws_8", a_down_throws_8);
run("len_push_9", a_len_push_9);
run("for_push_9", a_for_push_9);
run("for_length_9", a_for_length_9);
run("while_length_9", a_while_length_9);
run("down_element_9", a_down_element_9);
run("len_element_9", a_len_element_9);
run("while_own_9", a_while_own_9);
run("of_own_9", a_of_own_9);
run("for_prefix_9", a_for_prefix_9);
run("while_prefix_9", a_while_prefix_9);
run("for_behind_9", a_for_behind_9);
run("while_behind_9", a_while_behind_9);
run("of_twice_9", a_of_twice_9);
run("down_twice_9", a_down_twice_9);
run("len_both_9", a_len_both_9);
run("for_both_9", a_for_both_9);
run("len_cond_9", a_len_cond_9);
run("for_cond_9", a_for_cond_9);
run("for_either_9", a_for_either_9);
run("while_either_9", a_while_either_9);
run("for_answer_9", a_for_answer_9);
run("while_answer_9", a_while_answer_9);
run("down_answers_9", a_down_answers_9);
run("len_answers_9", a_len_answers_9);
run("of_lists_9", a_of_lists_9);
run("down_lists_9", a_down_lists_9);
run("of_alias_9", a_of_alias_9);
run("down_alias_9", a_down_alias_9);
run("len_pops_9", a_len_pops_9);
run("for_pops_9", a_for_pops_9);
run("of_stack_9", a_of_stack_9);
run("down_stack_9", a_down_stack_9);
run("down_shrinks_9", a_down_shrinks_9);
run("len_shrinks_9", a_len_shrinks_9);
run("of_reads_9", a_of_reads_9);
run("down_reads_9", a_down_reads_9);
run("len_over_9", a_len_over_9);
run("for_over_9", a_for_over_9);
run("for_update_9", a_for_update_9);
run("while_update_9", a_while_update_9);
run("of_after_9", a_of_after_9);
run("down_after_9", a_down_after_9);
run("of_calls_9", a_of_calls_9);
run("down_calls_9", a_down_calls_9);
run("of_given_9", a_of_given_9);
run("down_given_9", a_down_given_9);
run("while_sum_9", a_while_sum_9);
run("of_sum_9", a_of_sum_9);
run("while_max_9", a_while_max_9);
run("of_max_9", a_of_max_9);
run("len_left_9", a_len_left_9);
run("for_left_9", a_for_left_9);
run("len_goes_9", a_len_goes_9);
run("for_goes_9", a_for_goes_9);
run("len_ints_9", a_len_ints_9);
run("for_ints_9", a_for_ints_9);
run("down_doubles_9", a_down_doubles_9);
run("len_doubles_9", a_len_doubles_9);
run("for_joined_9", a_for_joined_9);
run("while_joined_9", a_while_joined_9);
run("len_made_9", a_len_made_9);
run("for_made_9", a_for_made_9);
run("of_inner_9", a_of_inner_9);
run("down_inner_9", a_down_inner_9);
run("len_rows_9", a_len_rows_9);
run("for_rows_9", a_for_rows_9);
run("len_self_9", a_len_self_9);
run("for_self_9", a_for_self_9);
run("len_late_9", a_len_late_9);
run("for_late_9", a_for_late_9);
run("while_odd_9", a_while_odd_9);
run("of_odd_9", a_of_odd_9);
run("of_moves_9", a_of_moves_9);
run("down_moves_9", a_down_moves_9);
run("of_named_9", a_of_named_9);
run("down_named_9", a_down_named_9);
run("for_spread_9", a_for_spread_9);
run("while_spread_9", a_while_spread_9);
run("len_none_9", a_len_none_9);
run("for_none_9", a_for_none_9);
run("while_two_9", a_while_two_9);
run("of_two_9", a_of_two_9);
run("len_call_9", a_len_call_9);
run("for_call_9", a_for_call_9);
run("for_throws_9", a_for_throws_9);
run("while_throws_9", a_while_throws_9);
run("of_push_10", a_of_push_10);
run("down_push_10", a_down_push_10);
run("down_length_10", a_down_length_10);
run("len_length_10", a_len_length_10);
run("while_element_10", a_while_element_10);
run("of_element_10", a_of_element_10);
run("len_own_10", a_len_own_10);
run("for_own_10", a_for_own_10);
run("down_prefix_10", a_down_prefix_10);
run("len_prefix_10", a_len_prefix_10);
run("down_behind_10", a_down_behind_10);
run("len_behind_10", a_len_behind_10);
run("for_twice_10", a_for_twice_10);
run("while_twice_10", a_while_twice_10);
run("of_both_10", a_of_both_10);
run("down_both_10", a_down_both_10);
run("of_cond_10", a_of_cond_10);
run("down_cond_10", a_down_cond_10);
run("down_either_10", a_down_either_10);
run("len_either_10", a_len_either_10);
run("down_answer_10", a_down_answer_10);
run("len_answer_10", a_len_answer_10);
run("while_answers_10", a_while_answers_10);
run("of_answers_10", a_of_answers_10);
run("for_lists_10", a_for_lists_10);
run("while_lists_10", a_while_lists_10);
run("for_alias_10", a_for_alias_10);
run("while_alias_10", a_while_alias_10);
run("of_pops_10", a_of_pops_10);
run("down_pops_10", a_down_pops_10);
run("for_stack_10", a_for_stack_10);
run("while_stack_10", a_while_stack_10);
run("while_shrinks_10", a_while_shrinks_10);
run("of_shrinks_10", a_of_shrinks_10);
run("for_reads_10", a_for_reads_10);
run("while_reads_10", a_while_reads_10);
run("of_over_10", a_of_over_10);
run("down_over_10", a_down_over_10);
run("down_update_10", a_down_update_10);
run("len_update_10", a_len_update_10);
run("for_after_10", a_for_after_10);
run("while_after_10", a_while_after_10);
run("for_calls_10", a_for_calls_10);
run("while_calls_10", a_while_calls_10);
run("for_given_10", a_for_given_10);
run("while_given_10", a_while_given_10);
run("len_sum_10", a_len_sum_10);
run("for_sum_10", a_for_sum_10);
run("len_max_10", a_len_max_10);
run("for_max_10", a_for_max_10);
run("of_left_10", a_of_left_10);
run("down_left_10", a_down_left_10);
run("down_goes_10", a_down_goes_10);
run("of_ints_10", a_of_ints_10);
run("down_ints_10", a_down_ints_10);
run("while_doubles_10", a_while_doubles_10);
run("of_doubles_10", a_of_doubles_10);
run("down_joined_10", a_down_joined_10);
run("len_joined_10", a_len_joined_10);
run("of_made_10", a_of_made_10);
run("down_made_10", a_down_made_10);
run("for_inner_10", a_for_inner_10);
run("while_inner_10", a_while_inner_10);
run("of_rows_10", a_of_rows_10);
run("down_rows_10", a_down_rows_10);
run("of_self_10", a_of_self_10);
run("down_self_10", a_down_self_10);
run("of_late_10", a_of_late_10);
run("down_late_10", a_down_late_10);
run("len_odd_10", a_len_odd_10);
run("for_odd_10", a_for_odd_10);
run("for_moves_10", a_for_moves_10);
run("while_moves_10", a_while_moves_10);
run("for_named_10", a_for_named_10);
run("while_named_10", a_while_named_10);
run("down_spread_10", a_down_spread_10);
run("len_spread_10", a_len_spread_10);
run("of_none_10", a_of_none_10);
run("down_none_10", a_down_none_10);
run("len_two_10", a_len_two_10);
run("for_two_10", a_for_two_10);
run("of_call_10", a_of_call_10);
run("down_call_10", a_down_call_10);
run("down_throws_10", a_down_throws_10);
run("len_throws_10", a_len_throws_10);
function odd(make, n, v) { const o = [0.5]; make(o); let s = 0; for (let i = 0; i < n; i++) { o.push(v); s += o.length; } return show([o, s]); }
function oddOwn(make, n, v) { "use strict"; const o = [1, 2]; make(o); let s = 0; for (let i = 0; i < n; i++) { o[o.length] = v; s += o.length; } return show([o, s]); }
function oddInside(make, n, v) { const o = []; let s = 0; for (let i = 0; i < n; i++) { o.push(v); if (i === 5) make(o); s += o.length; } return show([o, s]); }
const makes = [o => {}, o => Object.freeze(o), o => Object.seal(o), o => Object.preventExtensions(o), o => Object.defineProperty(o, "length", { writable: false }), o => Object.defineProperty(o, 3, { get() { calls++; return 9; }, set() { calls += 10; }, configurable: true }), o => { o.push = function (x) { calls++; this[this.length] = 7; return 1; }; }, o => { o.length = 70000; }, o => { o[200] = 1; }, o => { o.fill("t"); }, o => Object.setPrototypeOf(o, { push() { calls += 100; return 3; } }), o => Object.setPrototypeOf(o, null)];
for (const make of makes) for (const v of [1, 0.5, NaN, "t", undefined]) for (const n of [1, 3, 8, 60]) for (const f of [odd, oddOwn, oddInside]) { calls = 0; let answer; try { answer = f(make, n, v); } catch (e) { answer = e.constructor.name; } keep("odd " + (answer.length > 900 ? answer.length + answer.slice(-300) : answer) + " " + calls); }
{ const p = [0]; const x = numbers[1]; for (let i = 0; i < x.length; i++) p.push(p[i] + x[i]); keep("module " + show(p)); const d = []; for (let i = 0; i < 300; i++) d[d.length] = i * 0.5; keep("module " + show(d)); }
async function later(x, n, v) { const o = [0.5]; for (let i = 0; i < n; i++) { o.push(o[i] + v); if (i % 16 === 5) await 0; } return show(o); }
for (const n of [0, 3, 40, 300]) for (const v of [1, 0.25, NaN, "t"]) keep("later " + await later(numbers[0], n, v));
for (const n of [1, 3]) { const o = [0.5]; o.length = 4294967294; let s = 0; try { for (let i = 0; i < n; i++) s += o.push(i + 0.5); } catch (e) { s = e.constructor.name; } keep("longest " + s + " " + o.length + " " + o[4294967294] + " " + o[4294967295] + " " + o["4294967296"]); }
console.log(cases, digest); for (const x of said) console.log(x);

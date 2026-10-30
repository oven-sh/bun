#!/usr/bin/env python3
"""what-crosses-an-await.py <folder>: Values that cross a suspension live in registers in a small function and in the frame in one of more than 32 suspensions. Every function here is written TWICE: as it is, and `giant`, with 33 suspensions more on a road that is never taken: across.ts, one line a kind: small = giant = plain Bun."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
PADA = 'if (pad) { ' + 'await 0; ' * 33 + '}'
PADY = 'if (pad) { ' + 'yield 0; ' * 33 + '}'
F = [
# (a) born in the start function; the first suspension lies on another road
('a_born_ahead', 'async', '(c: boolean, s: string, n: number)', 'string', 'const x = s + "x"; const y = [s, x]; const d = n / 3; const i = n | 0; PAD let r = ""; if (c) { r = await later(s); } else { r = (await later(x)) + "e"; } return r + x + y[1] + d.toFixed(3) + i;'),
('a_may_return_first', 'async', '(c: boolean, s: string, n: number)', 'string', 'const x = { s }; PAD if (n % 5 === 0) return "early" + x.s; const w = await later(n); return x.s + w + (c ? "c" : "");'),
('a_first_await_in_a_loop', 'async', '(c: boolean, s: string, n: number)', 'string', 'const keep = [s]; let t = ""; PAD for (let i = 0; i < n % 4; ++i) { t += await later(keep[0] + i); } return t + keep.length + (c ? 1 : 0);'),
# (b) reassigned across awaits; what loop heads join
('b_reassigned', 'async', '(c: boolean, s: string, n: number)', 'string', 'let v = { w: s }; PAD if (c) v = { w: s + "c" }; const a = await later(v.w); v = { w: a + "2" }; const b = await later(v.w); v = { w: b + "3" }; await later(0); return v.w;'),
('b_loop_heads', 'async', '(c: boolean, s: string, n: number)', 'string', 'let acc = ""; let box = { n: 0 }; let d = 0.5; let k = 0; PAD for (let i = 0; i < 1 + n % 5; ++i) { acc += await later(s + i); box = { n: box.n + i }; d = d * 1.5 + i; k = (k + i) | 0; if (c && i === 2) continue; acc += "."; } return acc + box.n + d.toFixed(2) + k;'),
('b_swapped', 'async', '(c: boolean, s: string, n: number)', 'string', 'let a = [s], b = [s + "b"]; PAD for (let i = 0; i < 1 + n % 4; ++i) { const t: string[] = a; a = b; b = [t[0] + (await later(i))]; } return a[0] + "|" + b[0] + (c ? "" : "!");'),
('b_nested_loops', 'async', '(c: boolean, s: string, n: number)', 'string', 'let out = ""; PAD for (let i = 0; i < 1 + n % 3; ++i) { let row = [s + i]; for (let j = 0; j < 1 + (n + i) % 3; ++j) { row = [row[0] + (await later(j))]; if (c && j === 1) break; } out += row[0] + ";"; } return out;'),
# (c) try | catch | finally
('c_read_in_the_handler', 'async', '(c: boolean, s: string, n: number)', 'string', 'let seen = [s]; PAD try { seen = [s + "1"]; const m = mayThrow(c, s); seen = [m + "2"]; await later(0); mayThrow(n % 2 === 0, "second"); seen = [seen[0] + "3"]; } catch (e) { await later(1); return "caught " + (e as Error).message + seen[0]; } return seen[0];'),
('c_finally', 'async', '(c: boolean, s: string, n: number)', 'string', 'const log: string[] = []; let held = { s }; PAD try { held = { s: await later(s + "t") }; if (c) throw new Error("x"); log.push(held.s); } catch (e) { held = { s: held.s + (e as Error).message }; await later(0); log.push("c" + held.s); } finally { await later(0); log.push("f" + held.s + n); } return log.join();'),
('c_the_result_of_a_call_that_may_throw', 'async', '(c: boolean, s: string, n: number)', 'string', 'PAD try { const m = mayThrow(c, s); const w = await later(n); const m2 = mayThrow(n % 3 === 0, m + w); await later(0); return m + m2; } catch (e) { const t = (e as Error).message; await later(0); return "c:" + t; }'),
('c_loop_try_continue', 'async', '(c: boolean, s: string, n: number)', 'string', 'let out = [""]; PAD for (let i = 0; i < 4; ++i) { const here = s + i; try { if ((n + i) % 3 === 0) throw new Error(here); out = [out[0] + (await later(here))]; if (c && i === 1) continue; } catch (e) { out = [out[0] + "!" + (await later((e as Error).message))]; } finally { out = [out[0] + ","]; } } return out[0];'),
('c_awaits_a_rejection', 'async', '(c: boolean, s: string, n: number)', 'string', 'const before = [s, s + n]; let d = n / 7; PAD try { await (c ? Promise.reject(new Error("r" + n)) : later(0)); d += 1; } catch (e) { d += 2; return before[1] + (e as Error).message + d.toFixed(2); } return before[0] + d.toFixed(2);'),
# (e) young cells into an old frame
('e_old_frame', 'async', '(c: boolean, s: string, n: number)', 'string', 'const first = [s]; PAD await turn(); churn(); let young = [s + "y"]; await turn(); churn(); const younger = { y: young[0] + n }; young = [younger.y + "z"]; await turn(); churn(); return first[0] + young[0] + younger.y + (c ? "" : "-");'),
('e_old_frame_in_a_loop', 'async', '(c: boolean, s: string, n: number)', 'string', 'let chain: { v: string; next: unknown } = { v: s, next: null }; PAD for (let i = 0; i < 3; ++i) { await turn(); churn(); chain = { v: chain.v + i, next: c ? chain : null }; } await turn(); return chain.v + (chain.next ? "n" : "");'),
# (f) fractions and integers
('f_numbers', 'async', '(c: boolean, s: string, n: number)', 'string', 'let d = n / 3, e = n * 0.25, i = n | 0, j = (n * 7) | 0, b = c; PAD d += await later(0.5); i = (i + (await later(3))) | 0; e = e * d; j = j ^ i; b = !b; await later(0); return [d.toFixed(4), e.toFixed(4), i, j, b, s.length].join();'),
('f_many_numbers', 'async', '(c: boolean, s: string, n: number)', 'string', 'const a0 = n + 0.5, a1 = n + 1.5, a2 = n + 2.5, a3 = n + 3.5, a4 = n + 4.5, a5 = n + 5.5, a6 = n + 6.5, a7 = n + 7.5, a8 = n + 8.5, a9 = n + 9.5; const i0 = n | 1, i1 = n | 2, i2 = n | 4, i3 = n | 8, i4 = n | 16, i5 = n | 32; PAD const w = await later(1); return (a0 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + w).toFixed(1) + (i0 + i1 + i2 + i3 + i4 + i5) + s[0] + c;'),
('f_optional_and_null', 'async', '(c: boolean, s: string, n: number)', 'string', 'let m: number | undefined = c ? n : undefined; let o: { v: number } | null = c ? null : { v: n }; let u: string | number = c ? s : n; PAD await later(0); const r1 = String(m) + (o ? o.v : "null") + u; m = c ? undefined : n + 1; o = c ? { v: 1 } : null; u = c ? n : s; await later(0); return r1 + String(m) + (o ? o.v : "null") + u;'),
# closures over what crosses
('g_captured_by_a_closure', 'async', '(c: boolean, s: string, n: number)', 'string', 'let count = n; const bump = (): number => ++count; const words = [s]; PAD bump(); await later(0); bump(); words.push(String(count)); await later(0); return words.join() + bump() + c;'),
('g_this_and_arguments', 'async', '(c: boolean, s: string, n: number)', 'string', 'const all = [c, s, n].length; PAD const w = await later(s); const z = await later(n); return w + z + all;'),
]
G = [
# (d) generators
('d_yield_in_loops', '(s: string, n: number)', 'let acc = [s]; let d = 0.5; PAD for (let i = 0; i < 2 + n % 3; ++i) { const got = yield acc[0] + i; acc = [acc[0] + String(got)]; d += i / 2; } return acc[0] + d;'),
('d_finally_reads_what_lives', '(s: string, n: number)', 'const held = { s }; let step = [0]; PAD try { step = [1]; yield held.s + "1"; step = [2]; yield held.s + "2"; step = [3]; yield held.s + "3"; } finally { yield "f" + held.s + step[0] + n; } return "end";'),
('d_catch_from_outside', '(s: string, n: number)', 'let last = [s]; PAD for (let i = 0; i < 4; ++i) { try { last = [s + i]; yield last[0]; } catch (e) { last = [last[0] + "!" + String(e)]; yield "c" + last[0]; } } return last[0] + n;'),
('d_delegates', '(s: string, n: number)', 'const mine = [s]; PAD const r = yield* inner(s + "i", 1 + n % 3); yield mine[0] + String(r); return mine[0];'),
]
out = ['declare const console: { log(...values: any[]): void };', 'export { };',
 'const later = <T>(v: T): Promise<T> => Promise.resolve(v);',
 'let waiting: (() => void)[] = []; const turn = (): Promise<void> => new Promise<void>(done => { waiting.push(done); });',
 'function releaseThemAll(): void { const all = waiting; waiting = []; for (const done of all) done(); }',
 'let junk: unknown[] = []; function churn(): void { for (let i = 0; i < 40; ++i) junk[i % 64] = [i, "j" + i, { i }]; }',
 'function mayThrow(c: boolean, s: string): string { if (c) throw new Error("thrown " + s); return s + "m"; }',
 'function* inner(s: string, n: number): Generator<unknown, string, unknown> { let t = [s]; for (let i = 0; i < n; ++i) { t = [t[0] + String(yield t[0])]; } return t[0]; }',
 'function weigh(s: string): number { let h = 7; for (let i = 0; i < s.length; ++i) h = (h * 31 + s.charCodeAt(i)) % 1000003; return h; }']
for name, kind, params, ret, body in F:
    for variant, pad in (('small', ''), ('giant', PADA)):
        out.append('async function %s_%s%s: Promise<%s> { %s }' % (name, variant, params[:-1] + ', pad: boolean)', ret, body.replace('PAD', pad)))
for name, params, body in G:
    for variant, pad in (('small', ''), ('giant', PADY)):
        out.append('function* %s_%s%s: Generator<unknown, string, unknown> { %s }' % (name, variant, params[:-1] + ', pad: boolean)', body.replace('PAD', pad)))
out.append('''function drive(g: Generator<unknown, string, unknown>, how: number): string {
  let out = "";
  try {
    let r = g.next();
    for (let i = 0; i < 12 && !r.done; ++i) {
      out += String(r.value) + ";"; churn();
      if (how === 1 && i === 1) r = g.return("ret"); else if (how === 2 && i === 1) r = g.throw("thr"); else if (how === 3 && i === 2) return out + "abandoned"; else r = g.next(i);
    }
    return out + "=" + String(r.value);
  } catch (e) { return out + "escaped " + String(e); }
}''')
out.append('const given: any = (globalThis as any).arguments; const rounds: number = given && given.length ? +given[0] : 4; const each: number = given && given.length > 1 ? +given[1] : 30;')
out.append('async function main(): Promise<void> {')
out.append('  const names: string[] = []; const small: number[] = []; const giant: number[] = [];')
k = 0
for name, *_ in F:
    out.append('  { let a = 0, b = 0; for (let r = 0; r < rounds; ++r) { const one: Promise<string>[] = [], two: Promise<string>[] = []; for (let i = 0; i < each; ++i) { const c = (i + r) %% 2 === 0, s = "s" + i, n = r * 11 + i; one.push(%s_small(c, s, n, false)); two.push(%s_giant(c, s, n, false)); } for (let t = 0; t < 6; ++t) { await later(0); await later(0); releaseThemAll(); churn(); } for (const v of await Promise.all(one)) a = (a + weigh(v)) %% 1000003; for (const v of await Promise.all(two)) b = (b + weigh(v)) %% 1000003; } names.push("%s"); small.push(a); giant.push(b); }' % (name, name, name))
for name, *_ in G:
    out.append('  { let a = 0, b = 0; for (let r = 0; r < rounds; ++r) for (let i = 0; i < each; ++i) for (let how = 0; how < 4; ++how) { a = (a + weigh(drive(%s_small("s" + i, r * 11 + i, false), how))) %% 1000003; b = (b + weigh(drive(%s_giant("s" + i, r * 11 + i, false), how))) %% 1000003; } names.push("%s"); small.push(a); giant.push(b); }' % (name, name, name))
out.append('  for (let i = 0; i < names.length; ++i) console.log(names[i], small[i], giant[i], small[i] === giant[i] ? "" : "SMALL AND GIANT PART");')
out.append('}')
out.append('main().catch(e => console.log("FAILED", String(e)));')
open('across.ts', 'w').write('\n'.join(out) + '\n')
print(len(F), 'async,', len(G), 'generators, each twice')

#!/usr/bin/env python3
"""cast-into-annotated-variable.py <folder>: `var r: T = x as T` is held as `var r = x as T` is. Every row in two forms: `a` (annotated) and `b` (bare)."""
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''interface S { v: number }
interface T { id: string; n: number; sub: S | null }
const make = (n: number): T => ({ id: "t", n, sub: { v: n } });
const same = (a: unknown, b: unknown) => a === b;
const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name + ": " + (x as Error).message; } console.log(what + ": " + said); };
function use(t: T): string { t.n = t.n + 1; return t.id + ":" + t.n + ":" + (t.sub === null ? "null" : t.sub.v); }
const fresh = (): any => ({ id: "s", n: 7, sub: { v: 70 }, extra: 1 });
for (let i = 0; i < 100; i++) use(make(i));
'''
ROWS = {
'v1_read_and_stored': '''say("read", () => { const raw = fresh(); var r@T@ = raw as T; r.n = r.n + 1; return r.id + r.n + " " + raw.n + " " + same(r, raw) + " " + Object.keys(r).join(); });''',
'v2_nullable_and_narrowed': '''function pick(raw: any, c: boolean): string { var r@T | null@ = c ? (raw as T | null) : null; if (r !== null) { r.n = r.n + 1; return r.id + r.n + (r.sub !== null ? r.sub.v : "-"); } return "null"; }
say("narrowed", () => { const raw = fresh(); return pick(raw, true) + " " + raw.n + " " + pick(raw, false) + " " + pick(null, true); });''',
'v3_now_a_stranger_now_a_true_one': '''say("in a loop", () => { const raw = fresh(); let r@T@ = raw as T; let s = ""; for (let i = 0; i < 6; i++) { r = i % 2 ? (raw as T) : make(i); r.n = r.n + 1; s += r.id + r.n + ","; } return s + raw.n; });''',
'v4_handed_on_and_returned': '''function get(raw: any): T { var r@T@ = raw as T; return r; }
say("an argument", () => { const raw = fresh(); var r@T@ = raw as T; return use(r) + " " + raw.n + " " + same(r, raw); });
say("a result", () => { const raw = fresh(); const t = get(raw); t.n = t.n + 1; return t.id + t.n + " " + raw.n + " " + same(t, raw); });''',
'v5_a_closure_stores_to_it': '''say("captured", () => { const raw = fresh(); let r@T@ = raw as T; r = make(1); const set = () => { r = raw as T; }; const before = r.id + r.n; set(); r.n = r.n + 1; return before + " " + r.id + r.n + " " + raw.n + " " + same(r, raw); });''',
'v6_at_the_top_of_the_module': '''const rawAtTop = fresh();
let top@T@ = rawAtTop as T;
function readTop(): string { top.n = top.n + 1; return top.id + top.n; }
function setTop(t: T): void { top = t; }
say("top", () => readTop() + " " + rawAtTop.n + " " + same(top, rawAtTop)); say("then a true one", () => { setTop(make(3)); return readTop(); }); say("then the stranger", () => { top = rawAtTop as T; return readTop() + " " + rawAtTop.n; });''',
'v7_it_lacks_and_it_lies': '''say("lacks", () => { const raw: any = { id: "l" }; var r@T@ = raw as T; return String(r.id) + "|" + String(r.n) + "|" + String(r.sub); });
say("lies", () => { const raw: any = { id: 7, n: "x", sub: 5 }; var r@T@ = raw as T; return String(r.id) + "|" + String(r.n) + "|" + String(r.sub); });
say("no object", () => { const raw: any = 5; var r@T@ = raw as T; return String(r) + "|" + String((r as any).n); });''',
'v8_patterns_spread_and_below': '''say("a pattern", () => { const raw = fresh(); var r@T@ = raw as T; const { id, n } = r; return id + n; });
say("spread", () => { const raw = fresh(); var r@T@ = raw as T; const c = { ...r }; return Object.keys(c).join() + " " + same(c.sub, raw.sub); });
say("below", () => { const raw = fresh(); var r@T@ = raw as T; const s = r.sub!; s.v = s.v + 1; return s.v + " " + raw.sub.v + " " + same(s, raw.sub); });''',
'v9_stored_into_what_the_program_made': '''interface Box { t: T; list: T[] }
const box: Box = { t: make(0), list: [] };
say("a field", () => { const raw = fresh(); var r@T@ = raw as T; box.t = r; box.t.n = box.t.n + 1; return box.t.id + box.t.n + " " + raw.n + " " + same(box.t, raw); });
say("an element", () => { const raw = fresh(); var r@T@ = raw as T; box.list.push(r); const e = box.list[box.list.length - 1]; e.n = e.n + 1; return e.id + e.n + " " + raw.n + " " + same(e, raw); });
say("a Map", () => { const raw = fresh(); var r@T@ = raw as T; const m = new Map<string, T>(); m.set("k", r); const e = m.get("k")!; e.n = e.n + 1; return e.id + e.n + " " + raw.n + " " + same(e, raw); });''',
}
import re
for k, b in ROWS.items():
    for form in 'ab':
        text = re.sub(r'@([^@]*)@', (lambda m: ': ' + m.group(1)) if form == 'a' else (lambda m: ''), b)
        open('%s_%s.ts' % (k, form), 'w').write('// form %s\n' % ('a: annotated' if form == 'a' else 'b: bare') + HEAD + text + '\nexport {}\n')
print(2 * len(ROWS))

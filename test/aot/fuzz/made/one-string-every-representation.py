#!/usr/bin/env python3
"""one-string-every-representation.py <folder>: ONE CASE A FOLDER: a union of string literals is kept as a small integer, and a literal text that only types list is kept as a hash: THE SAME TEXT IN EVERY FORM A STRING CAN HAVE (8-bit, 16-bit that holds only Latin-1, a rope, a substring, an atom, out of JSON, out of a Buffer, out of a template) must pass a cast to the union and behave as the literal; near misses must not. Two programs: valid (must be as plain to the letter) and invalid (plain lets them pass: read the refusals)."""
import os, sys
out = sys.argv[1]
TEXTS = ['abc', '', 'a', 'caf\\u00e9', '\\u4e00\\u4e8c', 'a\\u0000b', '\\ud83d\\ude00', '\\ud83d', 'x'.join(['long'] * 60), '1', 'true', 'null', 'undefined', '__proto__', 'constructor', ' spaced ', 'line\\nbreak', '\\u00fc4.6:k', '\\u00fe']
HEAD = 'declare const console: { log(...values: unknown[]): void };\ndeclare const Buffer: { from(s: string, e?: string): { toString(e?: string): string } };\n'
union = ' | '.join('"%s"' % t for t in TEXTS)
FORMS = '''const wide = (s: string): string => ("\\u4e00" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s + ["", ""][0] : s.slice(0, 1) + [s.slice(1)][0];
const sub = (s: string): string => ("<<" + s + ">>").slice(2, 2 + s.length);
const parsed = (s: string): string => JSON.parse(JSON.stringify([s]))[0];
const key = (s: string): string => Object.keys({ [s]: 1 })[0] ?? s;
const templ = (s: string): string => `${s}`;
const chars = (s: string): string => { let r = ""; for (let i = 0; i < s.length; i++) r += String.fromCharCode(s.charCodeAt(i)); return r; };
const joined = (s: string): string => s.split("").join("");
const forms: [string, (s: string) => string][] = [["itself", s => s], ["wide", wide], ["rope", rope], ["sub", sub], ["parsed", parsed], ["key", key], ["templ", templ], ["chars", chars], ["joined", joined], ["wide rope", s => rope(wide(s))], ["sub of wide", s => wide(sub(s))]];
'''
BODY = '''type Kind = %s;
interface Holder { kind: Kind; maybe?: Kind | null }
class Kept { kind: Kind = "abc"; }
const show = (s: unknown): string => typeof s === "string" ? JSON.stringify(s).slice(0, 40) + "#" + s.length : String(s);
function cast(v: unknown): string { try { const k = v as Kind; return "passes " + show(k); } catch (e) { return "REFUSED"; } }
function held(v: unknown): string { try { const h: Holder = { kind: v as Kind }; const k = new Kept(); k.kind = h.kind; h.maybe = k.kind; return [show(h.kind), h.kind === v, h.maybe === k.kind, h.kind.length, typeof h.kind, JSON.stringify(h).length, Object.values(h).length, (h.kind + "!").length, h.kind ? 1 : 0, [h.kind].includes(v as Kind), new Set([h.kind, v]).size, ({ [h.kind]: 1 } as any)[v as string]].join(); } catch (e) { return "REFUSED"; } }
function byAny(v: unknown): string { try { const h: any = { kind: "abc" } as Holder; h.kind = v; return show(h.kind) + (h.kind === v); } catch (e) { return "REFUSED"; } }
'''
texts = ', '.join('"%s"' % t for t in TEXTS)
os.makedirs(out + "/valid-texts-in-every-form", exist_ok=True)
# the list of texts is built at run time from character codes, so that no literal of the union stands in the code as a constant
codes = 'const TEXTS: string[] = [%s].map(codes => String.fromCharCode(...codes));\n'
def units(t):
    s = t.encode().decode('unicode_escape') if '\\' in t else t
    u = s.encode('utf-16-le', 'surrogatepass'); return '[' + ','.join(str(u[i] | (u[i + 1] << 8)) for i in range(0, len(u), 2)) + ']'
open(out + "/valid-texts-in-every-form/main.ts", "w").write(HEAD + FORMS + BODY % union + codes % ', '.join(units(t) for t in TEXTS) + 'for (let round = 0; round < 3; round++) for (const t of TEXTS) for (const [name, form] of forms) { const v = form(t); const line = [cast(v), held(v), byAny(v)].join(" | "); if (round === 2) console.log(name, line); }\n')
NEAR = ['abd', 'ab', 'abcd', 'ABC', ' abc', 'abc ', 'cafe', 'caf\\u00e8', '\\u4e00', '\\u4e00\\u4e8c\\u4e09', 'a\\u0000c', 'a', 'ab\\u0000', '\\ud83d\\ude01', '\\ude00', 'x'.join(['long'] * 59), 'x'.join(['long'] * 61), 'x'.join(['long'] * 59 + ['lonG']), '2', 'false', 'proto', 'spaced', 'line break']
NEAR = [n for n in NEAR if n not in TEXTS]
os.makedirs(out + "/near-misses-in-every-form", exist_ok=True)
open(out + "/near-misses-in-every-form/main.ts", "w").write(HEAD + FORMS + BODY % union + codes % ', '.join(units(t) for t in NEAR) + 'const others: unknown[] = [1, true, null, undefined, {}, [], ["abc"], new String("abc"), Symbol("abc"), 1n, { toString() { return "abc"; } }];\nlet passed = 0, refused = 0;\nfor (let round = 0; round < 3; round++) { for (const t of TEXTS) for (const [name, form] of forms) { const v = form(t); for (const r of [cast(v), held(v), byAny(v)]) { if (r === "REFUSED") refused++; else { passed++; if (round === 2) console.log("PASSES", name, show(v)); } } } for (const v of others) for (const r of [cast(v), held(v), byAny(v)]) { if (r === "REFUSED") refused++; else { passed++; if (round === 2) console.log("PASSES", show(v)); } } }\nconsole.log("passed", passed, "refused", refused);\n')
print("2 programs")

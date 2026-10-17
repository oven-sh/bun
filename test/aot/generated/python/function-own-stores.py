#!/usr/bin/env python3
"""function-own-stores.py: in `if (!node.id) { node.id = next } return node.id` a read of `o.name` is taken for what the function stored to `o.name`. Here something else stores nil to the same place in between: an alias, a call, a closure, a setter, an await, a yield. Each row has types of its own."""
HEAD = '''declare const console: { log(...values: unknown[]): void };
function say(what: string, make: () => string): void { try { console.log(what + ":", make()); } catch (e) { console.log(what + ":", "throws", (e as Error).name); } }
async function sayLater(what: string, make: () => Promise<string>): Promise<void> { try { console.log(what + ":", await make()); } catch (e) { console.log(what + ":", "throws", (e as Error).name); } }
'''
TYPES = '''type Leaf$ = { text: string; l$: number };
function leaf$(text: string): Leaf$ { return { text, l$: $ }; }
type Holder$ = { h$: number; leaf: Leaf$; name: string };
function anew$(): Holder$ { return { h$: $, leaf: leaf$("t"), name: "n" }; }
type Loose$ = { leaf: Leaf$ | undefined; name: string | null };
'''
READ = 'const l = h.leaf; const s = h.name; return (l === undefined ? "no leaf" : l === null ? "null leaf" : l.text) + "," + (s === undefined ? "no name" : s === null ? "null name" : s + s.length);'
ROWS = [
("control", 'function f$(h: Holder$): string { h.leaf = leaf$("mine"); h.name = "mine"; READ }', 'return f$(anew$());'),
("an alias stores behind the function's own store", 'function f$(h: Holder$, w: Loose$): string { h.leaf = leaf$("mine"); h.name = "mine"; w.leaf = undefined; w.name = null; READ }', 'const h = anew$(); return f$(h, h);'),
("stored where it was missing, then an alias", 'function f$(h: Holder$, w: Loose$): string { if (!h.leaf) h.leaf = leaf$("mine"); if (!h.name) h.name = "mine"; w.leaf = undefined; w.name = null; READ }', 'const h = anew$(); return f$(h, h);'),
("a call that is handed the object as the wider type", 'function drop$(w: Loose$): void { w.leaf = undefined; w.name = null; }\nfunction f$(h: Holder$): string { h.leaf = leaf$("mine"); h.name = "mine"; drop$(h); READ }', 'return f$(anew$());'),
("a call that knows the object by a variable", 'const kept$ = anew$(); const loose$: Loose$ = kept$;\nfunction drop$(): void { loose$.leaf = undefined; loose$.name = null; }\nfunction f$(h: Holder$): string { h.leaf = leaf$("mine"); h.name = "mine"; drop$(); READ }', 'return f$(kept$);'),
("a closure", 'function f$(h: Holder$): string { const w: Loose$ = h; const drop = (): void => { w.leaf = undefined; w.name = null; }; h.leaf = leaf$("mine"); h.name = "mine"; drop(); READ }', 'return f$(anew$());'),
("a callback of a built-in", 'function f$(h: Holder$): string { const w: Loose$ = h; h.leaf = leaf$("mine"); h.name = "mine"; [1].forEach(() => { w.leaf = undefined; w.name = null; }); READ }', 'return f$(anew$());'),
("Partial<> of it, deleted", 'function f$(h: Holder$): string { const p: Partial<Holder$> = h; h.leaf = leaf$("mine"); h.name = "mine"; delete p.leaf; delete p.name; READ }', 'return f$(anew$());'),
("in a loop: stored at the head, cleared at the foot, read at the head", 'function f$(h: Holder$, w: Loose$): string { let out = ""; h.leaf = leaf$("mine"); h.name = "mine"; for (let i = 0; i < 2; i++) { const l = h.leaf; const s = h.name; out += (l === undefined ? "no leaf" : l.text) + (s === null ? "null name" : s) + ";"; w.leaf = undefined; w.name = null; } return out; }', 'const h = anew$(); return f$(h, h);'),
("on one branch alone", 'function f$(h: Holder$, w: Loose$, c: boolean): string { h.leaf = leaf$("mine"); h.name = "mine"; if (c) { w.leaf = undefined; w.name = null; } READ }', 'const h = anew$(), g = anew$(); return f$(h, h, true) + "/" + f$(g, g, false);'),
("another object of the type, the control for the alias", 'function f$(h: Holder$, w: Loose$): string { h.leaf = leaf$("mine"); h.name = "mine"; w.leaf = undefined; w.name = null; READ }', 'return f$(anew$(), anew$());'),
("a class: a method clears what the caller has stored", 'class C$ { c$ = $; leaf: Leaf$ = leaf$("c"); name = "c"; wipe(): void { const w: Loose$ = this; w.leaf = undefined; w.name = null; } }\nfunction f$(h: C$): string { h.leaf = leaf$("mine"); h.name = "mine"; h.wipe(); READ }', 'return f$(new C$());'),
("a setter beside it clears it", 'class S$ { s$ = $; leaf: Leaf$ = leaf$("c"); name = "c"; set other(x: number) { const w: Loose$ = this; w.leaf = undefined; w.name = null; } }\nfunction f$(h: S$): string { h.leaf = leaf$("mine"); h.name = "mine"; h.other = 1; READ }', 'return f$(new S$());'),
("held one level down", 'type Outer$ = { o$: number; inner: Holder$ };\nfunction f$(o: Outer$, w: Loose$): string { o.inner.leaf = leaf$("mine"); o.inner.name = "mine"; w.leaf = undefined; w.name = null; const h = o.inner; READ }', 'const o: Outer$ = { o$: $, inner: anew$() }; return f$(o, o.inner);'),
]
LATER = [
("an await in between", 'async function f$(h: Holder$): Promise<string> { h.leaf = leaf$("mine"); h.name = "mine"; await null; READ }', 'const h = anew$(); const w: Loose$ = h; const p = f$(h); w.leaf = undefined; w.name = null; return await p;'),
("a yield in between", 'function* f$(h: Holder$): Generator<number, string> { h.leaf = leaf$("mine"); h.name = "mine"; yield 1; READ }', 'const h = anew$(); const w: Loose$ = h; const it = f$(h); it.next(); w.leaf = undefined; w.name = null; return String(it.next().value);'),
]
out = [HEAD]
n = 400
for what, before, body in ROWS:
    n += 1
    out.append((TYPES + before.replace('READ', READ) + '\n' + 'say("%s", () => { %s });\n' % (what, body)).replace('$', str(n)))
for what, before, body in LATER:
    n += 1
    out.append((TYPES + before.replace('READ', READ) + '\n' + 'await sayLater("%s", async () => { %s });\n' % (what, body)).replace('$', str(n)))
print(''.join(out), end='')

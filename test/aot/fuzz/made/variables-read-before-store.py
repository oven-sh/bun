#!/usr/bin/env python3
"""variables-read-before-store.py <folder>: Variables that are really read before any store, which TypeScript accepts because the read stands in a nested function. A type, a use, a place; one program a place. Every row must answer as plain Bun or throw."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
TYPES = [  # name, declared type, a later value, uses (V stands for the variable)
 ('number', 'number', '7', ['V', 'V + 1', 'V * 2', 'V | 0', '-V', 'V > 0', 'V === 0', 'V == null', 'typeof V', '`${V}`', 'Math.floor(V)', '[V, V].length + ":" + String([V][0])', 'String(V)', 'V ? "yes" : "no"', 'V ?? "nothing"', 'Number.isNaN(V + 0)', 'V.toFixed(1)', 'isFinite(V)', '(V as number | undefined) === undefined']),
 ('boolean', 'boolean', 'true', ['V', '!V', 'V ? 1 : 2', 'V === false', 'V === true', 'V == null', 'typeof V', 'V && "and"', 'V || "or"', 'String(V)', 'Number(V)', '(V as boolean | undefined) === undefined']),
 ('string', 'string', '"text"', ['V', 'V + "x"', '`<${V}>`', 'typeof V', 'V === ""', 'V == null', 'V ? 1 : 2', 'V.length', 'V.toUpperCase()', 'String(V)', 'V ?? "nothing"']),
 ('bigint', 'bigint', '5n', ['String(V)', 'typeof V', 'V == null', 'V + 1n', 'V === 0n', 'V ? 1 : 2']),
 ('object', '{ x: number }', '{ x: 1 }', ['String(V)', 'typeof V', 'V == null', 'V.x', 'V ? 1 : 2', 'V?.x', 'JSON.stringify([V])']),
 ('array', 'number[]', '[1, 2]', ['String(V)', 'typeof V', 'V == null', 'V.length', 'V[0]', 'V ? 1 : 2', 'Array.isArray(V)']),
 ('instance', 'Point', 'new Point(1)', ['String(V)', 'typeof V', 'V == null', 'V.x', 'V.twice()', 'V instanceof Point']),
 ('function', '() => number', '() => 3', ['typeof V', 'V == null', 'V()', 'V === undefined']),
 ('union', 'number | string', '7', ['String(V)', 'typeof V', 'V == null', 'typeof V === "number" ? V + 1 : "no number"', 'V ? 1 : 2']),
 ('literal', '1 | 2', '1', ['String(V)', 'V === 1', 'V === 2', 'V + 1', 'typeof V']),
 ('tuple', '[number, string]', '[1, "a"]', ['String(V)', 'V == null', 'V[0]']),
 ('enum', 'Color', 'Color.Green', ['String(V)', 'V === Color.Red', 'V + 1', 'typeof V']),
]
HEAD = '''// %s: made by make.py: do not edit.
declare const console: { log(...values: unknown[]): void };
class Point { constructor(public x: number) { } twice(): number { return this.x * 2 } }
enum Color { Red, Green }
function show(v: unknown): string { return typeof v === "bigint" ? v + "n" : typeof v === "number" && Object.is(v, -0) ? "-0" : typeof v === "function" ? "a function" : typeof v + " " + (typeof v === "object" ? JSON.stringify(v) : String(v)) }
function row(name: string, f: () => unknown): void { let said: string; try { said = show(f()) } catch (e) { said = "THROWS " + (e instanceof Error ? e.name : "something") } console.log(name + " = " + said) }
const zero: number = [].length;
'''
def rows(place):
    out = []; n = 0
    for name, ty, later, uses in TYPES:
        for use in uses:
            n += 1; v = 'v%d' % n; e = use.replace('V', v); label = '%s | %s' % (name, use.replace('"', "'").replace('`', "'").replace('$', ''))
            if place == 'closure_called_ahead': out.append('function f%d() { let %s: %s; const read = () => %s; row("%s", read); %s = %s; row("   later", read) }\nf%d();' % (n, v, ty, e, label, v, later, n))
            elif place == 'of_the_module': out.append('let %s: %s;\nfunction f%d() { return %s }\nrow("%s", f%d); %s = %s; row("   later", f%d);' % (v, ty, n, e, label, n, v, later, n))
            elif place == 'one_arm': out.append('function f%d() { let %s: %s; if (zero > 0) %s = %s; row("%s", () => %s) }\nf%d();' % (n, v, ty, v, later, label, e, n))
            elif place == 'fresh_in_a_loop': out.append('function f%d() { for (let i = 0; i < 3; i++) { let %s: %s; const read = () => %s; if (i !== 1) %s = %s; row("%s | turn " + i, read) } }\nf%d();' % (n, v, ty, e, v, later, label, n))
            elif place == 'handed_on_typed': out.append('function f%d() { let %s: %s; const get = (): %s => %s; const take = (%s: %s) => %s; row("%s", () => take(get())); %s = %s; row("   later", () => take(get())) }\nf%d();' % (n, v, ty, ty, v, v, ty, e, label, v, later, n))
    return '\n'.join(out) + '\n'
for place in ('closure_called_ahead', 'of_the_module', 'one_arm', 'fresh_in_a_loop', 'handed_on_typed'):
    open(os.path.join(H, place + '.ts'), 'w').write(HEAD % place + rows(place))
print('made 5 programs,', sum(len(t[3]) for t in TYPES), 'rows a program')

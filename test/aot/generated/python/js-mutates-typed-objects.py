#!/usr/bin/env python3
"""what-javascript-does-to-an-object-it-was-handed.py <n>: what untyped code does to an object of typed code that it was handed is not refused.
The n-th of 681 programs: (door) x (kind of typed object) x (what a JavaScript file does to it). state.ts makes the object and reads it again; view.js alters it in between: a store of another kind, undefined, an object, a getter for a
while; a delete and a store again; another prototype; extra names; a freeze .. What it leaves behind fits the type again. The doors: view.js imports what makes the object | typed code hands the object over as an argument and reads
what comes back | typed code keeps its own reference and reads through that. Three files: main.ts, and behind a line `//// <name>` each, state.ts and view.js. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys
KINDS = {
 'record': ('export interface T { count: number; label: string }', '{ count: 1, label: "one" }', 'o.label + " " + o.count'),
 'literalUnion': ('export type Closed = { open: false; items: string[] };\nexport type Open = { open: true; items: string[]; at: number };\nexport type T = Closed | Open;', '{ open: false, items: [] }', '(o.open ? "open " + o.at : "closed") + " " + o.items.length'),
 'instance': ('export class T { count: number = 1; label: string = "one"; }', 'new T()', 'o.label + " " + o.count'),
 'instanceWithMethod': ('export class T { count: number = 1; label: string = "one"; show(): string { return this.label + this.count; } }', 'new T()', 'o.show() + " " + o.count'),
 'optional': ('export interface T { count: number; label?: string }', '{ count: 1 }', 'String(o.label) + " " + o.count'),
 'nested': ('export interface Inner { n: number }\nexport interface T { count: number; label: string; inner: Inner }', '{ count: 1, label: "one", inner: { n: 5 } }', 'o.label + " " + o.count + " " + o.inner.n'),
 'withArray': ('export interface T { count: number; label: string; list: number[] }', '{ count: 1, label: "one", list: [1, 2] }', 'o.label + " " + o.count + " " + o.list.join()'),
 'numberOrString': ('export interface T { count: number | string; label: string }', '{ count: 1, label: "one" }', 'o.label + " " + o.count'),
 'nullable': ('export interface T { count: number; label: string | null }', '{ count: 1, label: null }', 'String(o.label) + " " + o.count'),
 'enumField': ('export enum Color { Red, Green }\nexport interface T { count: number; label: string; color: Color }', '{ count: 1, label: "one", color: Color.Red }', 'o.label + " " + o.count + " " + o.color'),
}
# what the JavaScript does; `o` is the object; what is left fits again
ACTS = {
 'nothing': '',
 'sameKind': 'o.count = 2;',
 'otherKindForAWhile': 'o.count = "many"; seen.push(typeof o.count); o.count = 2;',
 'undefinedForAWhile': 'o.count = undefined; seen.push(typeof o.count); o.count = 2;',
 'objectForAWhile': 'o.count = { big: 1 }; seen.push(typeof o.count); o.count = 2;',
 'doubleForAWhile': 'o.count = 1.5; seen.push(o.count); o.count = 2;',
 'added': 'o.extra = 1; seen.push(Object.keys(o).join());',
 'addedAndDeleted': 'o.extra = 1; delete o.extra; seen.push(Object.keys(o).join());',
 'deletedAndPutBack': 'const kept = o.count; delete o.count; seen.push("count" in o); o.count = kept;',
 'definedAnew': 'Object.defineProperty(o, "count", { value: 2, writable: true, enumerable: true, configurable: true });',
 'getterForAWhile': 'Object.defineProperty(o, "count", { get() { return 7; }, enumerable: true, configurable: true }); seen.push(o.count); Object.defineProperty(o, "count", { value: 2, writable: true, enumerable: true, configurable: true });',
 'assigned': 'Object.assign(o, { count: 2, more: true });',
 'underAKey': 'const key = ["co", "unt"].join(""); o[key] = 2; o[key + "s"] = 3;',
 'element': 'o[0] = "zero"; o[7] = "seven"; seen.push(Object.keys(o).join());',
 'symbol': 'o[Symbol.for("s")] = 1; seen.push(Object.getOwnPropertySymbols(o).length);',
 'frozen': 'Object.freeze(o); seen.push(Object.isFrozen(o));',
 'sealed': 'Object.seal(o); o.count = 2; seen.push(Object.isSealed(o));',
 'otherPrototype': 'const was = Object.getPrototypeOf(o); Object.setPrototypeOf(o, { inherited: 1 }); seen.push(o.inherited); Object.setPrototypeOf(o, was);',
 'manyNames': 'for (let i = 0; i < 20; i++) o["n" + i] = i; seen.push(Object.keys(o).length);',
 'reflect': 'Reflect.set(o, "count", 2); Reflect.defineProperty(o, "late", { value: 1, enumerable: false }); seen.push(Reflect.ownKeys(o).join());',
 'spreadBack': 'o = { ...o, count: 2 };',
 'parsedBack': 'o = JSON.parse(JSON.stringify(o)); o.count = 2;',
 'copiedByAssign': 'o = Object.assign({}, o, { count: 2 });',
}
SPECIAL = {'literalUnion': {'sameKind': 'o.open = true; o.at = 4;', 'otherKindForAWhile': 'o.open = "half"; seen.push(typeof o.open); o.open = true; o.at = 4;'}}
programs = {}
for door in ("imported", "argument", "kept"):
  by_argument, is_kept = door != "imported", door == "kept"
  for kk, (declarations, make, show) in KINDS.items():
      for ak, act in ACTS.items():
          if kk == 'literalUnion':
              act = SPECIAL[kk].get(ak, act.replace('o.count', 'o.open').replace('"count"', '"open"').replace('count: 2', 'open: false').replace('= 2;', '= false;').replace('value: 2', 'value: false').replace('["co", "unt"]', '["op", "en"]').replace('"open", 2', '"open", false'))
          if kk in ('instance', 'instanceWithMethod') and ak in ('spreadBack', 'parsedBack', 'copiedByAssign') and kk == 'instanceWithMethod': continue
          files = programs[f'{door}.{kk}.{ak}'] = {}
          files['state.ts'] = (f'{declarations}\nexport function make(): T {{ return {make}; }}\nexport function show(o: T): string {{ return {show}; }}\nexport function keys(o: T): string {{ return Object.keys(o).join(); }}\n')
          if by_argument:
              files['view.js'] = (f'export function alter(o, seen) {{\n  try {{ {act} }} catch (error) {{ seen.push("THROWS " + String(error).split(" (bun")[0]); }}\n  return o;\n}}\n')
              files['main.ts'] = ('import { keys, make, show } from "./state.ts";\nimport { alter } from "./view.js";\nconst seen: unknown[] = [];\nfor (let round = 0; round < 3; round++) {\n  TAKING\n  seen.push(show(o), keys(o), JSON.stringify(o));\n}\nconsole.log(seen.join("\\n"));\n'.replace('TAKING', 'const o = make();\n  alter(o, seen);' if is_kept else 'const o = alter(make(), seen);'))
          else:
              files['view.js'] = (f'import {{ keys, make, show }} from "./state.ts";\nexport function run() {{\n  const seen = [];\n  for (let round = 0; round < 3; round++) {{\n    let o = make();\n    try {{ {act} }} catch (error) {{ seen.push("THROWS " + String(error).split(" (bun")[0]); }}\n    seen.push(show(o), keys(o), JSON.stringify(o));\n  }}\n  return seen.join("\\n");\n}}\n')
              files['main.ts'] = ('import { run } from "./view.js";\nconsole.log(run());\n')

names = list(programs)
if sys.argv[1] == 'count': print(len(names)); sys.exit()
if sys.argv[1] == 'names': print('\n'.join(names)); sys.exit()
files = programs[names[int(sys.argv[1])] if sys.argv[1].isdigit() else sys.argv[1]]
print(files['main.ts'] + ''.join('//// %s\n%s' % (name, files[name]) for name in ('state.ts', 'view.js')), end='')

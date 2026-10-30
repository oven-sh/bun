#!/usr/bin/env python3
"""ways-to-make-a-value-that-fits-its-type.py <n>: a value that satisfies its type is never refused for how it is made.
The n-th of 1,640 programs: (kind of type) x (how the value is made) x (door and container). Untyped code of the same file makes something that has `id: number` and `name: string` in one of forty ways: own, inherited, by accessors,
frozen, without a prototype, a function, an array, a Map, an Error with the two names, in dictionary mode .. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys, json
TYPES = {
 'interface': ('interface T { id: number; name: string }', '{ id: 0, name: "made" }'),
 'class': ('class T { id: number = 0; name: string = "made"; }', 'new T()'),
 'optional': ('interface T { id: number; name: string; note?: string }', '{ id: 0, name: "made" }'),
 'readonly': ('interface T { readonly id: number; name: string }', '{ id: 0, name: "made" }'),
}
MADE = {
 'byNames': 'const o: any = {}; o.id = 1; o.name = "given"; return o;',
 'otherOrder': 'const o: any = {}; o.name = "given"; o.id = 1; return o;',
 'noPrototype': 'const o: any = Object.create(null); o.id = 1; o.name = "given"; return o;',
 'inherited': 'const p: any = {}; p.id = 1; p.name = "given"; return Object.create(p);',
 'halfInherited': 'const p: any = {}; p.id = 1; const o: any = Object.create(p); o.name = "given"; return o;',
 'getters': 'const o: any = {}; Object.defineProperty(o, "id", { get() { return 1; }, enumerable: true, configurable: true }); let held = "given"; Object.defineProperty(o, "name", { get() { return held; }, set(v) { held = v; }, enumerable: true, configurable: true }); return o;',
 'getterOnPrototype': 'const p: any = {}; Object.defineProperty(p, "id", { get() { return 1; }, enumerable: true }); const o: any = Object.create(p); o.name = "given"; return o;',
 'frozen': 'const o: any = {}; o.id = 1; o.name = "given"; return Object.freeze(o);',
 'sealed': 'const o: any = {}; o.id = 1; o.name = "given"; return Object.seal(o);',
 'notExtensible': 'const o: any = {}; o.id = 1; o.name = "given"; return Object.preventExtensions(o);',
 'notEnumerable': 'const o: any = {}; Object.defineProperty(o, "id", { value: 1, writable: true, configurable: true }); Object.defineProperty(o, "name", { value: "given", writable: true, configurable: true }); return o;',
 'readOnly': 'const o: any = {}; Object.defineProperty(o, "id", { value: 1, enumerable: true }); Object.defineProperty(o, "name", { value: "given", enumerable: true }); return o;',
 'extras': 'const o: any = {}; o.before = 0; o.id = 1; o.between = 2; o.name = "given"; o.after = 3; return o;',
 'manyExtras': 'const o: any = {}; for (let i = 0; i < 100; i++) o["x" + i] = i; o.id = 1; o.name = "given"; return o;',
 'afterDeletes': 'const o: any = {}; o.a = 1; o.id = 1; o.b = 2; o.name = "given"; delete o.a; delete o.b; return o;',
 'symbols': 'const o: any = {}; o[Symbol("s")] = 0; o.id = 1; o.name = "given"; return o;',
 'elements': 'const o: any = {}; o[0] = "zero"; o.id = 1; o[7] = "seven"; o.name = "given"; return o;',
 'aFunction': 'const o: any = function given() {}; o.id = 1; return o;',
 'anArrow': 'const given: any = () => 1; given.id = 1; return given;',
 'anArray': 'const o: any = [9]; o.id = 1; o.name = "given"; return o;',
 'aMap': 'const o: any = new Map(); o.id = 1; o.name = "given"; return o;',
 'anError': 'const o: any = new Error("e"); o.id = 1; return o;',
 'aDate': 'const o: any = new Date(0); o.id = 1; o.name = "given"; return o;',
 'aRegExp': 'const o: any = /x/; o.id = 1; o.name = "given"; return o;',
 'aPromise': 'const o: any = Promise.resolve(0); o.id = 1; o.name = "given"; return o;',
 'bytes': 'const o: any = new Uint8Array(2); o.id = 1; o.name = "given"; return o;',
 'aStringObject': 'const o: any = new String("s"); o.id = 1; o.name = "given"; return o;',
 'ofAnUntypedClass': 'const Other: any = class { id: any; name: any; constructor() { this.id = 1; this.name = "given"; } }; return new Other();',
 'ofAConstructorFunction': 'const Other: any = function (this: any) { this.id = 1; this.name = "given"; }; return new Other();',
 'aClassItself': 'const Other: any = class given { static id = 1; }; return Other;',
 'parsed': 'return JSON.parse(\'{"id":1,"name":"given"}\');',
 'assigned': 'return Object.assign({}, JSON.parse(\'{"id":1}\'), JSON.parse(\'{"name":"given"}\'));',
 'fromEntries': 'return Object.fromEntries([["id", 1], ["name", "given"]]);',
 'spreadOfAny': 'const o: any = {}; o.id = 1; o.name = "given"; return { ...o };',
 'doubleId': 'const o: any = {}; o.id = 1.5; o.name = "given"; return o;',
 'bigId': 'const o: any = {}; o.id = 2 ** 40; o.name = "given"; return o;',
 'nanId': 'const o: any = {}; o.id = NaN; o.name = "given"; return o;',
 'minusZeroId': 'const o: any = {}; o.id = -0; o.name = "given"; return o;',
 'ropeName': 'const o: any = {}; o.id = 1; o.name = "giv".concat(String(o.id)) + "en".repeat(3); return o;',
 'emptyName': 'const o: any = {}; o.id = 1; o.name = ""; return o;',
 'wideName': 'const o: any = {}; o.id = 1; o.name = "g\\u00efv\\u4e16n"; return o;',
}
DOORS = {
 'annotation': 'const v: T = give();', 'cast': 'const v = give() as T;', 'result': 'function take(): T { return give(); }\nconst v = take();', 'parameter': 'PARAMETER',
 'element': 'const list: T[] = [give()];\nconst v = list[0];', 'arrayOfAny': 'const list: T[] = giveList();\nconst v = list[0];', 'field': 'class Holder { held: T | undefined = undefined; }\nconst holder = new Holder();\nholder.held = give();\nconst v = holder.held!;',
 'property': 'const holder: { held: T } = { held: give() };\nconst v = holder.held;', 'mapValue': 'const map = new Map<string, T>();\nmap.set("k", give());\nconst v = map.get("k")!;', 'pushed': 'const list: T[] = [];\nlist.push(give());\nconst v = list[0];',
}
programs = [(t, m, d) for t in TYPES for m in MADE for d in DOORS]
if sys.argv[1] == 'count': print(len(programs)); sys.exit()
if sys.argv[1] == 'names': print('\n'.join('.'.join(p) for p in programs)); sys.exit()
tk, mk, dk = programs[int(sys.argv[1])] if sys.argv[1].isdigit() else tuple(sys.argv[1].split('.'))
declarations, own = TYPES[tk]
uses = ['v.id', 'v.name', 'typeof v', 'read(v)', 'Object.keys(v).join()', 'JSON.stringify({ ...v })', '(({ id, name }) => name + id)(v)', '[v].map(read).join()', '(v.name = "written", v.name)', 'read(v)', '"name" in v', 'Object.hasOwn(v, "id")', 'kept.push(v), kept.map(read).join()', 'v === again', 'Object.getPrototypeOf(v) === Object.getPrototypeOf(again)', 'read(own)']
body = '\n'.join(f'row({json.dumps(u)}, () => ({u}));' for u in uses)
door = DOORS[dk]
text = f'function use(v: T) {{\n{body}\n}}\nuse(give());' if door == 'PARAMETER' else door + '\n' + body
print(f"""// {tk}.{mk}.{dk}
export {{}};
declare const console: any;
{declarations}
function make(): any {{ {MADE[mk]} }}
const again: any = make();
function give(): any {{ return again; }}
function giveList(): any {{ return [again]; }}
function row(name: string, run: () => unknown) {{ try {{ console.log(name + ": " + String(run())); }} catch (error) {{ console.log(name + ": THROWS " + (error as Error).name); }} }}
function read(x: T): string {{ return x.name + x.id; }}
const own: T = {own};
const kept: T[] = [own];
{text}""")

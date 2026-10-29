#!/usr/bin/env python3
"""values-that-fit-their-type.py <n>: a value that satisfies its type is never refused.
The n-th of 5,607 programs: (kind of type) x (container) x (door). Untyped code of the same file builds an object name by name, or the object is parsed, and it has every member that the type requires. It comes in through the door
(an annotation, a cast, the result of a function, a parameter, a field, a generic function, a callback, JSON.parse ..), held to the container of the type (the type itself, an array, a tuple, a Map, a Set, a Promise, a record, a
property, a function that yields it ..). Then it is used in a dozen ordinary ways, one line each. TypeScript's classes are structural, so this goes for classes as for interfaces.
One program each, because a type that admits such objects does so in the whole program. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys, json
TYPES = {
 'fields': ('class T0 { id: number = 0; name: string = "made"; }', 'T0', '{ id: 1, name: "given" }', True, 'T0', []),
 'parameters': ('class T0 { constructor(public id: number, public name: string) {} }', 'T0', '{ id: 1, name: "given" }', True, 'T0', []),
 'optional': ('class T0 { readonly id: number = 0; name: string = "made"; note?: string; }', 'T0', '{ id: 1, name: "given" }', True, 'T0', ['String(v.note)']),
 'heir': ('class Base { id: number = 0; }\nclass T0 extends Base { name: string = "made"; }', 'T0', '{ id: 1, name: "given" }', True, 'T0', []),
 'method': ('class T0 { id: number = 0; name: string = "made"; label(): string { return this.name + this.id; } }', 'T0', '{ id: 1, name: "given", label() { return "own " + this.name; } }', False, 'T0', ['v.label()']),
 'getter': ('class T0 { id: number = 0; name: string = "made"; get label(): string { return this.name + this.id; } }', 'T0', '{ id: 1, name: "given", label: "own" }', True, 'T0', ['v.label']),
 'abstract': ('abstract class T0 { id: number = 0; name: string = "made"; }\nclass Real extends T0 {}', 'T0', '{ id: 1, name: "given" }', True, 'T0', []),
 'generic': ('class Box<V> { id: number = 0; name: string = "made"; constructor(public value: V) {} }', 'Box<number>', '{ id: 1, name: "given", value: 7 }', True, 'Box', ['v.value + 1']),
 'nested': ('class Inner { n: number = 0; }\nclass T0 { id: number = 0; name: string = "made"; inner: Inner = new Inner(); }', 'T0', '{ id: 1, name: "given", inner: { n: 5 } }', True, 'T0', ['v.inner.n']),
 'listed': ('class Inner { n: number = 0; }\nclass T0 { id: number = 0; name: string = "made"; all: Inner[] = []; }', 'T0', '{ id: 1, name: "given", all: [{ n: 5 }] }', True, 'T0', ['v.all[0].n', 'v.all.map(each => each.n).join()']),
 'interface': ('interface T0 { id: number; name: string }', 'T0', '{ id: 1, name: "given" }', True, None, []),
 'alias': ('type T0 = { id: number; name: string };', 'T0', '{ id: 1, name: "given" }', True, None, []),
 'extended': ('interface Base { id: number }\ninterface T0 extends Base { name: string }', 'T0', '{ id: 1, name: "given" }', True, None, []),
 'implemented': ('interface T0 { id: number; name: string }\nclass Real implements T0 { id = 0; name = "made"; }', 'T0', '{ id: 1, name: "given" }', True, 'Real', []),
 'union': ('interface A0 { kind: "a"; id: number; name: string }\ninterface B0 { kind: "b"; id: number; name: string; more: number }\ntype T0 = A0 | B0;', 'T0', '{ kind: "b", id: 1, name: "given", more: 2 }', True, None, ['v.kind === "b" ? v.more : -1']),
 'classUnion': ('class A0 { kind: "a" = "a"; id: number = 0; name: string = "made"; }\nclass B0 { kind: "b" = "b"; id: number = 0; name: string = "made"; more: number = 0; }\ntype T0 = A0 | B0;', 'T0', '{ kind: "b", id: 1, name: "given", more: 2 }', True, 'B0', ['v.kind === "b" ? v.more : -1']),
 'wider': ('class T0 { id: number = 0; name: string = "made"; }', 'T0', '{ id: 1, name: "given", extra: true }', True, 'T0', []),
 'enumField': ('enum Color { Red, Green }\nclass T0 { id: number = 0; name: string = "made"; color: Color = Color.Red; }', 'T0', '{ id: 1, name: "given", color: 1 }', True, 'T0', ['v.color === Color.Green']),
}
MAKE_OWN = {'fields': 'new T0()', 'parameters': 'new T0(0, "made")', 'optional': 'new T0()', 'heir': 'new T0()', 'method': 'new T0()', 'getter': 'new T0()', 'abstract': 'new Real()', 'generic': 'new Box(3)', 'nested': 'new T0()', 'listed': 'new T0()',
 'interface': '{ id: 0, name: "made" }', 'alias': '{ id: 0, name: "made" }', 'extended': '{ id: 0, name: "made" }', 'implemented': 'new Real()', 'union': '{ kind: "a", id: 0, name: "made" }', 'classUnion': 'new A0()', 'wider': 'new T0()', 'enumField': 'new T0()'}
CONTAINERS = {
 'itself': ('T', 'X', 'c', True), 'array': ('T[]', '[X]', 'c[0]', True), 'readonlyArray': ('readonly T[]', '[X]', 'c[0]', True), 'tuple': ('[T, number]', '[X, 1]', 'c[0]', True),
 'map': ('Map<string, T>', 'new Map([["k", X]])', 'c.get("k")!', False), 'set': ('Set<T>', 'new Set([X])', '[...c][0]', False), 'promise': ('Promise<T>', 'Promise.resolve(X)', 'await c', False),
 'record': ('Record<string, T>', '{ k: X }', 'c.k', True), 'property': ('{ inner: T }', '{ inner: X }', 'c.inner', True), 'arrayInProperty': ('{ items: T[] }', '{ items: [X] }', 'c.items[0]', True),
 'orUndefined': ('T | undefined', 'X', 'c!', True), 'orNull': ('T | null', 'X', 'c!', True), 'arrays': ('T[][]', '[[X]]', 'c[0][0]', True), 'mapOfArrays': ('Map<string, T[]>', 'new Map([["k", [X]]])', 'c.get("k")![0]', False),
 'promiseOfArray': ('Promise<T[]>', 'Promise.resolve([X])', '(await c)[0]', False), 'thunk': ('(() => T)', '() => X', 'c()', False), 'iterable': ('Iterable<T>', '[X]', '[...c][0]', True), 'orString': ('(T | string)[]', '[X, "s"]', 'c[0] as @', True),
 'optionalProperty': ('{ inner?: T }', '{ inner: X }', 'c.inner!', True), 'forOf': ('T[]', '[X]', '(() => { for (const each of c) return each; throw new Error("empty"); })()', True), 'destructured': ('{ inner: T }', '{ inner: X }', '(({ inner }) => inner)(c)', True),
}
DOORS = {
 'annotation': ('const c: C = give();', False), 'cast': ('const c = give() as C;', False), 'doubleCast': ('const c = give() as unknown as C;', False), 'result': ('function take(): C { return give(); }\nconst c = take();', False),
 'parameter': ('PARAMETER', False), 'field': ('class Holder { c: C | undefined = undefined; }\nconst holder = new Holder();\nholder.c = give();\nconst c = holder.c!;', False), 'generic': ('const c = giveAs<C>();', False),
 'asyncResult': ('async function take(): Promise<C> { return give(); }\nconst c = await take();', False), 'callback': ('CALLBACK', False), 'parsed': ('const c: C = JSON.parse(text);', True), 'parsedCast': ('const c = JSON.parse(text) as C;', True),
 'parsedResult': ('function take(from: string): C { return JSON.parse(from); }\nconst c = take(text);', True), 'json': ('async function take(from: string): Promise<C> { return await new Response(from).json(); }\nconst c = await take(text);', True),
 'letLater': ('let c: C;\nc = give();', False), 'arrow': ('const take = (): C => give();\nconst c = take();', False), 'method': ('class Source { take(): C { return give(); } }\nconst c = new Source().take();', False),
}

def untyped(value):
    import re
    s = value
    s = s.replace('label() { return "own " + this.name; }', 'label: function (this: any) { return "own " + this.name; }')
    out, i = [], 0
    def parse(i):
        assert s[i] == '{'; i += 1; entries = []
        while True:
            while s[i] in ' ,': i += 1
            if s[i] == '}': return 'obj([' + ', '.join(entries) + '])', i + 1
            m = re.match(r'(\w+): ', s[i:]); key = m.group(1); i += m.end()
            v, i = parse_value(i); entries.append('["%s", %s]' % (key, v))
    def parse_value(i):
        if s[i] == '{': return parse(i)
        if s[i] == '[':
            i += 1; items = []
            while True:
                while s[i] in ' ,': i += 1
                if s[i] == ']': return '[' + ', '.join(items) + ']', i + 1
                v, i = parse_value(i); items.append(v)
        if s.startswith('function', i):
            j = s.index('; }', i) + 3; return s[i:j], j
        m = re.match(r'"[^"]*"|[\w.]+', s[i:]); return m.group(0), i + m.end()
    return parse(0)[0]
DOORS['generic'] = ('function giveAs<G>(): G { return give(); }\nconst c = giveAs<C>();', False)
DOORS['asyncGeneric'] = ('async function giveAs<G>(): Promise<G> { return give(); }\nconst c = await giveAs<C>();', False)
del DOORS['json']
programs = []
for tk, (declarations, T, value, value_is_data, cls, extra) in TYPES.items():
  for ck, (C, wrap, extract, container_is_data) in CONTAINERS.items():
    for dk, (door, wants_data) in DOORS.items():
      if wants_data and not (value_is_data and container_is_data): continue
      if ck in ('promise', 'promiseOfArray') and dk in ('asyncResult', 'asyncGeneric'): continue
      programs.append((tk, ck, dk))
if sys.argv[1] == 'count': print(len(programs)); sys.exit()
if sys.argv[1] == 'names': print('\n'.join('.'.join(p) for p in programs)); sys.exit()
tk, ck, dk = programs[int(sys.argv[1])] if sys.argv[1].isdigit() else tuple(sys.argv[1].split('.'))
declarations, T, value, value_is_data, cls, extra = TYPES[tk]; C, wrap, extract, container_is_data = CONTAINERS[ck]; door, wants_data = DOORS[dk]
ctype = C.replace('T', '@').replace('@', T)
uses = ['v.id', 'v.name', 'typeof v', 'JSON.stringify(v)', 'Object.keys(v).join()', 'JSON.stringify({ ...v })', '(({ id, name }) => name + id)(v)', 'read(v)', '[v].map(read).join()', '(v.name = "written", v.name)', 'read(v)', '(() => { const names: string[] = []; for (const key in v) names.push(key); return names.join(); })()', '"name" in v', 'kept.push(v), kept.map(read).join()', 'new Map([["m", v]]).get("m")!.name', 'read(own)'] + extra
if cls: uses.append(f'v instanceof {cls}')
body = '\n'.join(f'row({json.dumps(u)}, () => ({u}));' for u in uses)
taking = f'const v: {T} = {extract.replace("@", T)};'
if door == 'PARAMETER': text = f'async function use(c: {ctype}) {{\n{taking}\n{body}\n}}\nawait use(give());'
elif door == 'CALLBACK': text = f'await giveTo(async (c: {ctype}) => {{\n{taking}\n{body}\n}});'
else: text = door.replace('C', '@').replace('@', ctype) + f'\n{taking}\n{body}'
inner = untyped(value)
wrapped = wrap.replace('{ k: X }', 'obj([["k", X]])').replace('{ inner: X }', 'obj([["inner", X]])').replace('{ items: [X] }', 'obj([["items", [X]]])').replace('X', inner)
print(f"""// {tk}.{ck}.{dk}
export {{}};
declare const console: any;
{declarations}
function obj(entries: any[]): any {{ const o: any = {{}}; for (const entry of entries) o[entry[0]] = entry[1]; return o; }}
function give(): any {{ return {wrapped}; }}
function giveTo(callback: (value: any) => unknown): unknown {{ return callback(give()); }}
const text: string = {'JSON.stringify(give())' if value_is_data and container_is_data else '"null"'};
function row(name: string, run: () => unknown) {{ try {{ console.log(name + ": " + String(run())); }} catch (error) {{ console.log(name + ": THROWS " + String(error).split(" (bun")[0]); }} }}
function read(x: {T}): string {{ return x.name + x.id; }}
const own: {T} = {MAKE_OWN[tk]};
const kept: {T}[] = [own];
{text}""")

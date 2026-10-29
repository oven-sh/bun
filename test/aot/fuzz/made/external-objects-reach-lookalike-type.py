#!/usr/bin/env python3
"""external-objects-reach-lookalike-type.py <folder>: Roads by which a given object reaches a place of a look-alike record type `Mine` (which the program also MAKES, so that it has a layout) without itself crossing at an assignment: held in a container, handed through a function type, through generic code, in a field of a made record. Each row prints what is read, identity with the given object, and a store through Mine seen through Given."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''interface Given { id: string; n: number; more?: boolean }
interface Mine { id: string; n: number }
function parse(text: string): Given { return JSON.parse(text) as Given; }
function make(id: string, n: number): Mine { return { id, n }; }
function read(m: Mine): string { return m.id + ":" + m.n; }
function bump(m: Mine): void { m.n = m.n + 1; }
const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name + ": " + (x as Error).message; } console.log(what + ": " + said); };
const given = parse('{"id":"g","n":1}');
const own = make("m", 10);
say("own", () => { bump(own); return read(own); });
'''
ROWS = {
'a0_control_an_argument': '''say("direct", () => { bump(given); return read(given) + " " + given.n; });''',
'c1_a_map': '''function all(m: Map<string, Mine>): string { let s = ""; for (const [k, v] of m) { bump(v); s += k + "=" + read(v) + ";"; } return s + read(m.get("g")!); }
const held = new Map<string, Given>(); held.set("g", given);
say("map", () => all(held) + " " + given.n + " " + ((held.get("g") as unknown) === (given as unknown)));''',
'c2_a_set': '''function all(m: Set<Mine>): string { let s = ""; for (const v of m) { bump(v); s += read(v) + ";"; } return s; }
const held = new Set<Given>(); held.add(given);
say("set", () => all(held) + " " + given.n);''',
'c3_a_promise': '''async function load(): Promise<Given> { return given; }
async function use(p: Promise<Mine>): Promise<string> { const v = await p; bump(v); return read(v); }
use(load()).then(s => console.log("promise: " + s + " " + given.n), x => console.log("promise: THROWS " + (x as Error).constructor.name + ": " + (x as Error).message));''',
'c4_an_array': '''function all(m: Mine[]): string { let s = ""; for (const v of m) { bump(v); s += read(v) + ";"; } return s + read(m[0]); }
const held: Given[] = [given];
say("array", () => all(held) + " " + given.n);''',
'c5_a_dictionary': '''function all(m: Record<string, Mine>): string { let s = ""; for (const k in m) { bump(m[k]); s += k + "=" + read(m[k]) + ";"; } return s; }
const held: Record<string, Given> = {}; held["g"] = given;
say("dictionary", () => all(held) + " " + given.n);''',
'c6_a_tuple': '''function first(m: [Mine, number]): string { bump(m[0]); return read(m[0]); }
const held: [Given, number] = [given, 1];
say("tuple", () => first(held) + " " + given.n);''',
'c7_a_generator': '''function* each(): Generator<Given> { yield given; }
function all(m: Iterable<Mine>): string { let s = ""; for (const v of m) { bump(v); s += read(v) + ";"; } return s; }
say("generator", () => all(each()) + " " + given.n);''',
'c8_a_made_array_pushed_through_another_name': '''const mines: Mine[] = [own];
const givenOnes: Given[] = mines;
givenOnes.push(given);
say("pushed", () => { let s = ""; for (const v of mines) { bump(v); s += read(v) + ";"; } return s + given.n; });''',
'f1_a_function_that_yields': '''function take(f: () => Mine): string { const v = f(); bump(v); return read(v); }
const source: () => Given = () => given;
say("yields", () => take(source) + " " + given.n);''',
'f2_a_function_that_takes': '''function call(f: (g: Given) => string): string { return f(given); }
const sink = (m: Mine): string => { bump(m); return read(m); };
say("takes", () => call(sink) + " " + given.n);''',
'f3_a_callback_of_the_engine': '''const list: Given[] = [given];
say("map", () => list.map((m: Mine) => { bump(m); return read(m); }).join() + " " + given.n);
say("forEach", () => { let s = ""; list.forEach((m: Mine) => { bump(m); s += read(m); }); return s + " " + given.n; });
say("sort", () => [given, given].sort((a: Mine, b: Mine) => a.n - b.n).length);
say("find", () => read(list.find((m: Mine) => m.n > 0)!));''',
'f4_a_method': '''interface Handler { on(g: Given): string }
class Impl { on(m: Mine): string { bump(m); return read(m); } }
function fire(h: Handler): string { return h.on(given); }
say("method", () => fire(new Impl()) + " " + given.n);''',
'f5_a_function_in_a_field': '''interface Wants { cb: (g: Given) => string }
interface Has { cb: (m: Mine) => string }
const has: Has = { cb: m => { bump(m); return read(m); } };
function fire(w: Wants): string { return w.cb(given); }
say("field", () => fire(has) + " " + given.n);''',
'f6_generic_apply': '''function apply<X, Y>(x: X, f: (x: X) => Y): Y { return f(x); }
say("apply", () => apply(given, (m: Mine) => { bump(m); return read(m); }) + " " + given.n);
say("apply as Mine", () => apply<Mine, string>(given, m => { bump(m); return read(m); }) + " " + given.n);''',
'f7_generic_identity': '''function same<X>(x: X): X { return x; }
say("identity", () => { const m: Mine = same<Mine>(given); bump(m); return read(m) + " " + given.n + " " + ((m as unknown) === (given as unknown)); });
say("identity, inferred", () => { const m = same<Mine>(given); bump(m); return read(m) + " " + given.n; });''',
'f8_bound_and_called': '''const sink = function (this: void, m: Mine): string { bump(m); return read(m); };
const bound: (g: Given) => string = sink.bind(undefined);
say("bound", () => bound(given) + " " + given.n);
say("call", () => (sink as (g: Given) => string).call(undefined, given));''',
'f9_a_default_and_a_rest': '''function rest(...all: Mine[]): string { let s = ""; for (const v of all) { bump(v); s += read(v) + ";"; } return s; }
const list: Given[] = [given, given];
say("rest", () => rest(...list) + " " + given.n);
say("rest, one", () => rest(given, own) + " " + given.n);''',
'r1_a_field_of_a_made_record': '''interface HoldsGiven { v: Given }
interface HoldsMine { v: Mine }
const h: HoldsGiven = { v: given };
function use(m: HoldsMine): string { bump(m.v); return read(m.v); }
say("held", () => use(h) + " " + given.n + " " + ((h.v as unknown) === (given as unknown)));
const mine: HoldsMine = { v: own };
say("held, made", () => use(mine));''',
'r2_a_generic_class': '''class Holder<X> { constructor(public v: X) {} get(): X { return this.v; } }
function use(m: Holder<Mine>): string { bump(m.v); return read(m.get()); }
say("holder", () => use(new Holder<Given>(given)) + " " + given.n);
say("holder, made", () => use(new Holder<Mine>(own)));''',
'r3_stored_through_the_other_view': '''interface HoldsGiven { v: Given }
interface HoldsMine { v: Mine }
const mine: HoldsMine = { v: own };
const seen: HoldsGiven = mine;
seen.v = given;
say("stored", () => { bump(mine.v); return read(mine.v) + " " + given.n; });''',
'r4_a_generic_record': '''interface Cell<X> { v: X; next: Cell<X> | null }
function cell<X>(v: X): Cell<X> { return { v, next: null }; }
function use(m: Cell<Mine>): string { bump(m.v); return read(m.v); }
say("cell", () => use(cell(given)) + " " + given.n);
say("cell, made", () => use(cell(own)));''',
's1_readonly_partial_pick_base': '''interface Base { id: string }
interface Derived extends Base { n: number }
function parseDerived(text: string): Derived { return JSON.parse(text) as Derived; }
const d = parseDerived('{"id":"d","n":2}');
function base(b: Base): string { return b.id; }
function ro(b: Readonly<Given>): string { return b.id + b.n; }
function part(b: Partial<Given>): string { return String(b.id) + String(b.n); }
function pick(b: Pick<Given, "id">): string { return b.id; }
const madeBase: Base = { id: "b" };
say("base", () => base(d) + base(madeBase));
say("readonly", () => ro(given)); say("partial", () => part(given)); say("pick", () => pick(given));''',
'u1_spread_and_assign': '''say("spread", () => { const m: Mine = { ...given }; bump(m); return read(m) + " " + given.n; });
say("assign", () => { const m: Mine = Object.assign(make("z", 0), given); bump(m); return read(m) + " " + given.n; });
say("assign onto given", () => { const m: Mine = Object.assign(given, { n: 7 }); bump(m); return read(m) + " " + given.n; });''',
'u2_destructured': '''interface Wrap { inner: Given; list: Given[] }
const w = JSON.parse('{"inner":{"id":"i","n":3},"list":[{"id":"l","n":4}]}') as Wrap;
say("pattern", () => { const { inner }: { inner: Mine } = w; bump(inner); return read(inner) + " " + w.inner.n; });
say("pattern of a parameter", () => (({ inner }: { inner: Mine }) => { bump(inner); return read(inner); })(w));
say("array pattern", () => { const [first]: Mine[] = w.list; bump(first); return read(first) + " " + w.list[0].n; });''',
'u3_caught_thrown_yielded': '''say("thrown", () => { try { throw given; } catch (x) { const m = x as Mine; bump(m); return read(m) + " " + given.n + " " + ((m as unknown) === (given as unknown)); } });
function* gen(): Generator<number, void, Mine> { const m = yield 1; bump(m); console.log("sent: " + read(m)); }
say("sent", () => { const g = gen(); g.next(); const send: (v: Given) => unknown = v => g.next(v); send(given); return given.n; });''',
'u4_a_class_field_and_a_static': '''class Keeps { static last: Mine = own; m: Mine; constructor(m: Mine) { this.m = m; Keeps.last = m; } }
say("field", () => { const k = new Keeps(given); bump(k.m); bump(Keeps.last); return read(k.m) + " " + given.n; });''',
'u5_conditional_and_logical': '''function pick(c: boolean): Mine { return c ? given : own; }
function or(g: Given | null): Mine { return g || own; }
function nn(g: Given | undefined): Mine { return g ?? own; }
say("conditional", () => { const m = pick(true); bump(m); return read(m) + read(pick(false)) + " " + given.n; });
say("or", () => read(or(given)) + read(or(null))); say("nullish", () => read(nn(given)) + read(nn(undefined)));''',
'l1_the_data_lies_below': '''const lies = [parse('{"id":5,"n":"text"}'), parse('{"id":null,"n":null}'), parse('{}'), parse('{"id":{"x":1},"n":[1]}')];
for (const l of lies) { say("read", () => read(l)); say("typeof", () => ((m: Mine) => typeof m.id + " " + typeof m.n)(l)); }''',
'l2_what_is_given_is_no_object': '''const lies = [parse('"text"'), parse('5'), parse('true'), parse('null'), parse('[1,2]')];
for (const l of lies) { say("kind", () => ((m: Mine) => typeof m)(l)); }
const held = new Map<string, Given>(); lies.forEach((l, i) => held.set(String(i), l));
function kinds(m: Map<string, Mine>): string { let s = ""; for (const v of m.values()) s += typeof v + ";"; return s; }
say("kinds in a map", () => kinds(held));''',
}
here = os.getcwd()
for name, body in ROWS.items():
    open(os.path.join(here, name + '.ts'), 'w').write(HEAD + body + '\n')
print(len(ROWS), 'rows')

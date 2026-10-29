#!/usr/bin/env python3
"""external-objects-checker-compares-differently.py <folder>: Roads by which a given object reaches a place of the type `Mine` where TypeScript compares the two types the other way round, compares nothing, or compares another pair. Each row prints what is read, whether the object is the same one, and a store through Mine seen through the given name."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''interface Given { id: string; n: number; more?: boolean }
interface Mine { id: string; n: number }
function parse(text: string): Given { return JSON.parse(text) as Given; }
function make(id: string, n: number): Mine { return { id, n }; }
function read(m: Mine): string { return m.id + ":" + m.n; }
function bump(m: Mine): void { m.n = m.n + 1; }
const same = (a: unknown, b: unknown) => a === b;
const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name + ": " + (x as Error).message; } console.log(what + ": " + said); };
const given = parse('{"id":"g","n":1}');
const own = make("m", 10);
say("own", () => { bump(own); return read(own); });
'''
ROWS = {
'b1_a_method_is_bivariant': '''interface TakesGiven { on(x: Given): string }
let kept: Mine | null = null;
const taker = { on(x: Mine): string { kept = x; bump(x); return read(x); } };
const seen: TakesGiven = taker;
say("method", () => seen.on(given) + " " + given.n + " " + same(kept, given));''',
'b2_a_method_of_a_class_is_bivariant': '''interface TakesGiven { on(x: Given): string }
class Taker { kept: Mine | null = null; on(x: Mine): string { this.kept = x; bump(x); return read(x); } }
const taker = new Taker(); const seen: TakesGiven = taker;
say("method", () => seen.on(given) + " " + given.n + " " + same(taker.kept, given));''',
'b3_bivariant_in_an_array_of_handlers': '''interface TakesGiven { on(x: Given): string }
const handlers: TakesGiven[] = [];
let kept: Mine | null = null;
handlers.push({ on(x: Mine): string { kept = x; bump(x); return read(x); } });
say("method", () => handlers.map(h => h.on(given)).join() + " " + given.n + " " + same(kept, given));''',
'g1_a_guard_written_by_hand': '''function isOfMine(x: unknown): x is Mine { return typeof x === "object" && x !== null && "id" in x; }
say("guard", () => { const u: unknown = given; if (isOfMine(u)) { bump(u); return read(u) + " " + given.n + " " + same(u, given); } return "no"; });''',
'g2_a_guard_narrows_the_given_type': '''interface More extends Given { more: boolean }
function hasMore(x: Given): x is More { return x.more !== undefined; }
function tell(m: More): string { m.n = m.n + 1; return m.id + m.n + m.more; }
const other = parse('{"id":"h","n":5,"more":true}');
const made: More = { id: "o", n: 1, more: false };
say("made", () => tell(made));
say("guard", () => hasMore(other) ? tell(other) + " " + other.n : "no");''',
'g3_an_assertion_function': '''function assertMine(x: unknown): asserts x is Mine { if (typeof x !== "object") throw new Error("no"); }
say("asserts", () => { const u: unknown = given; assertMine(u); bump(u); return read(u) + " " + given.n + " " + same(u, given); });''',
'p1_a_type_parameter_with_a_constraint': '''function through<X extends Mine>(x: X): string { const m: Mine = x; bump(m); return read(m); }
say("constraint", () => through(given) + " " + given.n);''',
'p2_a_type_parameter_kept_in_a_generic_class': '''class Box<X> { constructor(public held: X) { } get(): X { return this.held; } }
function open(b: Box<Mine>): string { const m = b.get(); bump(m); return read(m); }
say("box", () => { const b = new Box(given); return open(b) + " " + given.n + " " + same(b.held, given); });''',
'p3_keyof_and_indexed_access': '''interface HoldsGiven { it: Given } interface HoldsMine { it: Mine }
function pick<T, K extends keyof T>(t: T, k: K): T[K] { return t[k]; }
const holder: HoldsGiven = { it: given };
function use(h: HoldsMine): string { const m = pick(h, "it"); bump(m); return read(m); }
say("picked", () => use(holder) + " " + given.n);''',
'm1_mapped_types': '''function use(m: Readonly<Mine>): string { return m.id + m.n; }
function part(m: Partial<Mine>): string { m.n = (m.n ?? 0) + 1; return String(m.id) + m.n; }
function need(m: Required<Mine>): string { bump(m); return read(m); }
say("readonly", () => use(given)); say("partial", () => part(given) + " " + given.n); say("required", () => need(given) + " " + given.n);
say("own", () => use(own) + part(own) + need(own));''',
'm2_an_intersection': '''interface Tagged { tag?: string }
function use(m: Mine & Tagged): string { bump(m); m.tag = "t"; return read(m) + m.tag; }
say("intersection", () => use(given) + " " + given.n + " " + JSON.stringify(given));
say("own", () => use(own) + JSON.stringify(own));''',
'l1_a_literal_kept_in_a_variable': '''const mine = { id: "lit", n: 2 };
function look(g: Given): string { g.more = true; return g.id + g.n + g.more; }
say("a literal looked at as Given", () => look(mine) + " " + JSON.stringify(mine));
say("and as Mine", () => { bump(mine); return read(mine) + " " + JSON.stringify(mine); });''',
'l2_given_in_a_literal_in_a_variable': '''const holder = { it: given, k: 1 };
function use(h: { it: Mine; k: number }): string { bump(h.it); return read(h.it) + h.k; }
say("nested", () => use(holder) + " " + given.n + " " + same(holder.it, given));''',
'o1_an_overload': '''function pickOne(x: string): string; function pickOne(x: Mine): string; function pickOne(x: string | Mine): string { if (typeof x === "string") return x; bump(x); return read(x); }
say("overload", () => pickOne(given) + " " + given.n);''',
'o2_an_optional_and_a_default': '''function opt(m?: Mine): string { if (!m) return "none"; bump(m); return read(m); }
function dflt(m: Mine = given): string { bump(m); return read(m); }
say("optional", () => opt(given) + " " + given.n); say("default", () => dflt() + " " + given.n);''',
'r1_a_conditional_expression_and_or': '''function choose(c: boolean): Mine { return c ? given : own; }
function orElse(m: Mine | null): Mine { return m ?? given; }
say("conditional", () => { const m = choose(true); bump(m); return read(m) + " " + given.n + " " + same(m, given); });
say("or", () => { const m = orElse(null); bump(m); return read(m) + " " + given.n + " " + same(m, given); });''',
'r2_destructured': '''const { it }: { it: Mine } = { it: given };
const [first]: Mine[] = [given];
say("object pattern", () => { bump(it); return read(it) + " " + given.n + " " + same(it, given); });
say("array pattern", () => { bump(first); return read(first) + " " + given.n + " " + same(first, given); });''',
'r3_satisfies_and_const': '''const table = { a: given, b: own } satisfies Record<string, Mine>;
function use(t: Record<string, Mine>): string { let s = ""; for (const k in t) { bump(t[k]); s += read(t[k]); } return s; }
say("satisfies", () => use(table) + " " + given.n + " " + same(table.a, given));''',
'c1_a_class_field_and_a_static': '''class Keeps { static last: Mine = own; it: Mine; constructor(it: Mine) { this.it = it; Keeps.last = it; } }
say("field", () => { const k = new Keeps(given); bump(k.it); bump(Keeps.last); return read(k.it) + " " + given.n + " " + same(k.it, given) + same(Keeps.last, given); });''',
'c2_a_class_that_looks_alike': '''class Rec { id = "c"; n = 0; }
function use(r: Rec): string { r.n = r.n + 1; return r.id + r.n + (r instanceof Rec); }
say("own", () => use(new Rec()));
say("given as the class", () => use(given) + " " + given.n);''',
'e1_thrown_and_caught': '''function raise(): never { throw given; }
say("caught", () => { try { raise(); } catch (e) { const m = e as Mine; bump(m); return read(m) + " " + given.n + " " + same(m, given); } });''',
'e2_a_getter_and_a_setter': '''class Cell { private held: Mine = own; get it(): Mine { return this.held; } set it(m: Mine) { this.held = m; } }
say("accessor", () => { const c = new Cell(); c.it = given; bump(c.it); return read(c.it) + " " + given.n + " " + same(c.it, given); });''',
'e3_a_generator_and_an_iterator': '''function* each(): Generator<Given, void, Mine> { const back = yield given; bump(back); }
say("yielded and sent back", () => { const g = each(); const first = g.next(); const m: Mine = first.value as Given; bump(m); g.next(given); return read(m) + " " + given.n + " " + same(m, given); });''',
'a1_an_array_literal_reduced_by_subtype': '''const both = [own, given];
say("array literal", () => { let s = ""; for (const m of both) { bump(m); s += read(m) + ";"; } return s + given.n + " " + same(both[1], given); });''',
'a2_a_conditional_whose_type_is_inferred': '''function choose(c: boolean) { return c ? own : given; }
say("conditional", () => { const m = choose(false); bump(m); return read(m) + " " + given.n + " " + same(m, given); });''',
'a3_returns_whose_union_is_reduced': '''function choose(c: number) { if (c === 0) return own; if (c === 1) return given; return make("z", 0); }
say("returns", () => { const m = choose(1); bump(m); return read(m) + " " + given.n + " " + same(m, given); });''',
'a4_or_and_nullish_inferred': '''const none: Mine | null = (Date.now() < 0) ? own : null;
say("nullish", () => { const m = none ?? given; bump(m); return read(m) + " " + given.n + " " + same(m, given); });
say("or", () => { const m = none || given; bump(m); return read(m) + " " + given.n + " " + same(m, given); });''',
's1_the_source_is_an_intersection': '''interface Tagged { tag?: string }
const gx: Given & Tagged = parse('{"id":"x","n":7,"tag":"t"}');
say("intersection", () => { bump(gx); return read(gx) + " " + gx.n + " " + gx.tag; });''',
's2_the_source_is_a_mapped_type': '''const ro: Readonly<Given> = given; const pk: Pick<Given, "id" | "n"> = given; const om: Omit<Given, "more"> = given;
say("readonly", () => read(ro)); say("pick", () => { bump(pk); return read(pk) + " " + given.n + " " + same(pk, given); }); say("omit", () => { bump(om); return read(om) + " " + given.n + " " + same(om, given); });''',
's3_the_source_is_a_type_parameter': '''function via<X extends Given>(x: X): string { bump(x); return read(x); }
function free<X>(x: X, use: (x: X) => string): string { return use(x); }
say("constraint", () => via(given) + " " + given.n); say("free", () => free(given, m => { bump(m); return read(m); }) + " " + given.n); say("free, a function of Mine", () => free<Given>(given, read));''',
's4_the_source_is_a_union': '''interface Other { id: string; n: number; other: true }
function parseEither(t: string): Given | Other { return JSON.parse(t); }
say("union", () => { const u = parseEither('{"id":"u","n":3}'); bump(u); return read(u) + " " + u.n; });''',
'n1_below_a_given_type': '''interface GivenTree { root: Given; kids: Given[] } interface MineTree { root: Mine; kids: Mine[] }
function parseATree(t: string): GivenTree { return JSON.parse(t); }
function walk(t: MineTree): string { bump(t.root); let s = read(t.root); for (const k of t.kids) { bump(k); s += read(k); } return s; }
const madeTree: MineTree = { root: own, kids: [make("k", 1)] };
say("made", () => walk(madeTree));
say("tree", () => { const t = parseATree('{"root":{"id":"r","n":1},"kids":[{"id":"k","n":2}]}'); return walk(t) + " " + t.root.n + t.kids[0].n; });''',
'z1_control_no_road_at_all': '''say("given alone", () => given.id + given.n);''',
}
for k, b in ROWS.items(): open(k + '.ts', 'w').write(HEAD + b + '\nexport {}\n')
print(len(ROWS))

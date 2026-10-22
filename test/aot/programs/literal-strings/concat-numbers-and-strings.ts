// Where a value of a union of string literals and a string that comes out of `any` meet: `!`, `??`, `||`, `&&`, `?:`, defaults, loops, handlers, destructuring. A string out of `any` goes on whether or not it spells one of the literals: a literal type promises the kind, string.
type Kind = "alpha" | "beta" | "gamma" | "";
interface Holder { kind?: Kind; other?: Kind | null }
const outside: any = JSON.parse('{"kind":"beta","other":"delta","list":["gamma","alpha","zeta"],"empty":"","nothing":null}');
function asserted(h: Holder, o: any): Kind { return (h.kind ?? o.kind)!; }
function assertedOr(h: Holder, o: any): Kind { return (h.kind || o.other)!; }
function assertedAnd(h: Holder, o: any): Kind { return (h.kind && o.kind)!; }
function chosen(c: boolean, h: Holder, o: any): Kind | undefined { return c ? h.kind : o.kind; }
function chosenAsserted(c: boolean, h: Holder, o: any): Kind { return (c ? h.kind : o.other)!; }
function withDefault(o: any, kind: Kind = o.kind): Kind { return kind; }
function fromPattern({ kind = "gamma" as Kind, other = outside.other as Kind }: Holder): string { return kind + "/" + other; }
function carried(o: any): string {
    let kind: Kind = "alpha", trace = "";
    for (const next of o.list) { trace += kind === "alpha" ? "A" : kind === "gamma" ? "G" : "?"; kind = next; }
    return trace + kind;
}
function caught(o: any, fails: boolean): Kind {
    let kind: Kind = "alpha";
    try { if (fails) throw o.other; kind = o.kind; } catch (thrown) { kind = thrown as Kind; }
    return kind;
}
function nested(h: Holder, o: any, n: number): Kind { return (n === 0 ? h.kind : n === 1 ? o.kind : n === 2 ? (h.other ?? o.empty) : o.other)!; }
function stored(h: Holder, o: any): Holder { h.kind = (h.other || o.kind)!; h.other = o.nothing ?? h.kind; return h; }
function rank(kind: Kind | undefined | null): number { return kind === "alpha" ? 1 : kind === "beta" ? 2 : kind === "gamma" ? 3 : kind === "" ? 4 : kind == null ? 5 : 6; }
async function awaited(o: any, h: Holder): Promise<Kind> { const kind: Kind = (await Promise.resolve(h.kind)) ?? (await o.kind); return kind; }
function* yielded(o: any): Generator<Kind, Kind, Kind> { let kind: Kind = "alpha"; for (let i = 0; i < 3; i++) kind = (yield kind) ?? o.kind; return kind; }
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return (e as Error).constructor.name; } }
const out: unknown[] = [];
for (const h of [{}, { kind: "alpha" }, { kind: "", other: "gamma" }, { other: null }] as Holder[]) {
    out.push(attempt(() => asserted(h, outside)), attempt(() => assertedOr(h, outside)), attempt(() => assertedAnd(h, outside)), attempt(() => chosen(true, h, outside)), attempt(() => chosen(false, h, outside)), attempt(() => chosenAsserted(true, h, outside)), attempt(() => chosenAsserted(false, h, outside)));
    out.push(attempt(() => fromPattern(h)), attempt(() => rank(asserted(h, outside))), attempt(() => rank(assertedOr(h, outside))), attempt(() => rank(chosen(true, h, outside))));
    for (let n = 0; n < 4; n++) out.push(attempt(() => nested(h, outside, n)), attempt(() => rank(nested(h, outside, n))));
    out.push(attempt(() => JSON.stringify(stored({ ...h }, outside))));
}
out.push(attempt(() => withDefault(outside)), attempt(() => withDefault(outside, "gamma")), attempt(() => carried(outside)), attempt(() => caught(outside, false)), attempt(() => caught(outside, true)), attempt(() => rank(caught(outside, true))));
const steps = yielded(outside);
out.push(attempt(() => steps.next().value), attempt(() => steps.next("beta").value), attempt(() => steps.next(undefined as unknown as Kind).value), attempt(() => steps.next("zeta" as Kind).value));
console.log(out.map(String).join(" | "));
Promise.all([awaited(outside, {}), awaited(outside, { kind: "gamma" })]).then(all => console.log(all.join(), all.map(rank).join()));

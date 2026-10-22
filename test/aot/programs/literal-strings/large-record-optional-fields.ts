// A record with many optional fields, few of which are ever set: those of a union of string literals among them, which may be kept apart from the object. Another string passes a cast to the union, and typed code reads what untyped code stored into such a field as it is: a literal type promises the kind, string.
type Scope = "params" | "typeParams" | "";
type Side = "left" | "right";
interface Links {
    id: number;
    n0?: number;
    s0?: string;
    n1?: number;
    s1?: string;
    n2?: number;
    s2?: string;
    n3?: number;
    s3?: string;
    n4?: number;
    s4?: string;
    n5?: number;
    s5?: string;
    n6?: number;
    s6?: string;
    n7?: number;
    s7?: string;
    n8?: number;
    s8?: string;
    n9?: number;
    s9?: string;
    n10?: number;
    s10?: string;
    n11?: number;
    s11?: string;
    n12?: number;
    s12?: string;
    n13?: number;
    s13?: string;
    n14?: number;
    s14?: string;
    n15?: number;
    s15?: string;
    n16?: number;
    s16?: string;
    n17?: number;
    s17?: string;
    n18?: number;
    s18?: string;
    n19?: number;
    s19?: string;
    n20?: number;
    s20?: string;
    n21?: number;
    s21?: string;
    n22?: number;
    s22?: string;
    n23?: number;
    s23?: string;
    scope?: Scope;
    side?: Side | null;
    last?: Scope;
}
function links(id: number): Links {
    return { id };
}
function describe(l: Links): string {
    try {
        const scope = l.scope === "params" ? "P" : l.scope === "typeParams" ? "T" : l.scope === "" ? "E" : l.scope === undefined ? "-" : "?" + l.scope;
        const side = l.side === "left" ? "L" : l.side === "right" ? "R" : l.side === null ? "N" : l.side === undefined ? "-" : "?";
        return scope + side + (l.last ?? "none") + ("scope" in l ? "+" : "") + (l.n3 ?? "") + (l.s7 ?? "");
    } catch (e) {
        return (e as Error).constructor.name;
    }
}
function anyRead(o: any): string { return String(o.scope) + "/" + String(o.side) + "/" + String(o.last); }
function anyWrite(o: any, scope: unknown, side: unknown) { o.scope = scope; o.side = side; }
const all: Links[] = [];
let refused = 0;
for (let i = 0; i < 3000; i++) {
    const l = links(i);
    if (i % 3 === 0) l.scope = i % 2 ? "params" : "typeParams";
    if (i % 5 === 0) l.side = i % 2 ? "left" : i % 4 ? "right" : null;
    if (i % 7 === 0) try { l.last = ("made " + i) as Scope; } catch (e) { refused++; }
    if (i % 11 === 0) l.scope = "";
    if (i % 13 === 0) { l.n3 = i; l.s7 = "s" + i; }
    all.push(l);
}
console.log("casts refused:", refused);
let garbage = 0;
for (let i = 0; i < 200000; i++) garbage += ("g" + i).length;
const seen = new Map<string, number>();
for (const l of all) { const d = describe(l).replace(/[0-9]+/g, "#"); seen.set(d, (seen.get(d) ?? 0) + 1); }
console.log([...seen].sort().map(e => e.join("=")).join(" "), garbage);
console.log(describe(all[0]), describe(all[21]), describe(all[35]), describe(all[1001]), anyRead(all[0]), anyRead(all[1]), anyRead(all[7]), JSON.stringify(all[105]), Object.keys(all[2310]).join());
for (let i = 0; i < all.length; i += 4) anyWrite(all[i], i % 8 ? "params" : "unknown " + i, i % 12 ? "right" : undefined);
console.log(describe(all[4]), describe(all[8]), describe(all[12]), describe(all[24]), anyRead(all[16]), JSON.stringify(all[20]));
delete all[4].scope;
all[8].scope = undefined;
console.log(describe(all[4]), describe(all[8]), "scope" in all[4], "scope" in all[8], JSON.stringify({ ...all[12] }));

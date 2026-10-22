// A string from anywhere that spells one of the literals of a union enters the union, and is compared as what it spells. A string that spells none of them enters too, and compares unequal to each of them.
type Kind = "leaf" | "node" | "root";
interface Item { kind: Kind; size: number }

function isLeaf(k: Kind): boolean {
    return k === "leaf";
}
function which(k: Kind): number {
    switch (k) {
        case "leaf": return 1;
        case "node": return 2;
        case "root": return 3;
        default: return 0;
    }
}
function same(a: Kind, b: Kind): boolean {
    return a === b;
}
function differ(a: Kind, b: Kind): boolean {
    return a !== b;
}
function hold(k: Kind): Item {
    return { kind: k, size: k.length };
}
function text(parts: string[]): string {
    let made = "";
    for (const part of parts) made += part;
    return made;
}
function isKind(s: string): s is Kind {
    return s === "leaf" || s === "node" || s === "root";
}

const rope = text(["le", "af"]) as Kind;
const sliced = "a node!".slice(2, 6) as Kind;
const parsed = JSON.parse('["root", "stranger", "stranger", "leaf", ""]') as Kind[];
const fromAny: any = "no" + "de";
const viaAny: Kind = fromAny;
console.log(isLeaf(rope), which(rope), isLeaf(sliced), which(sliced), which(viaAny), same(viaAny, sliced), same(rope, "leaf"), differ(rope, parsed[3]));
try {
    for (const k of parsed)
        console.log(k, isLeaf(k), which(k), same(k, parsed[1]), same(k, parsed[2]), differ(k, "root"), hold(k).kind, hold(k).size, JSON.stringify(hold(k)));
} catch (e) {
    console.log("a stranger passed:", (e as Error).constructor.name);
}
try {
    const strangerA = hold(parsed[1]);
    const strangerB = hold(text(["stran", "ger"]) as Kind);
    console.log(strangerA.kind === strangerB.kind, same(strangerA.kind, strangerB.kind), strangerA.kind, typeof strangerB.kind, strangerB.kind.length, which(strangerB.kind));
    strangerA.kind = "node";
    strangerB.kind = strangerA.kind;
    console.log(strangerA.kind === strangerB.kind, which(strangerB.kind));
} catch (e) {
    console.log("a stranger held:", (e as Error).constructor.name);
}
for (const s of ["leaf", "twig", text(["ro", "ot"])]) {
    if (isKind(s))
        console.log(s, which(s), hold(s).kind);
    else
        console.log(s, "is none");
}
let narrowed: string = text(["no", "de"]);
if (narrowed === "node" || narrowed === "leaf") {
    const item = hold(narrowed);
    console.log(item.kind, which(item.kind), which(narrowed));
}
try {
    const many: Item[] = [];
    for (let i = 0; i < 2000; i++)
        many.push(hold(text(["made", String(i % 7)]) as Kind));
    let equal = 0;
    for (let i = 1; i < many.length; i++)
        equal += many[i].kind === many[i - 7 < 0 ? 0 : i - 7].kind ? 1 : 0;
    console.log(equal, many[1999].kind);
} catch (e) {
    console.log("a stranger cast:", (e as Error).constructor.name);
}

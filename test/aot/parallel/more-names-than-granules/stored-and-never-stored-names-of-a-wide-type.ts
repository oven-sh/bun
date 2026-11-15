interface Wide {
    kind: "wide";
    opt00?: number;
    opt01?: number;
    opt02?: number;
    opt03?: number;
    opt04?: number;
    opt05?: number;
    opt06?: number;
    opt07?: number;
    opt08?: number;
    opt09?: number;
    opt10?: number;
    opt11?: number;
    opt12?: number;
    opt13?: number;
    opt14?: number;
    opt15?: number;
    opt16?: number;
    opt17?: number;
    opt18?: number;
    opt19?: number;
    opt20?: number;
    opt21?: number;
    opt22?: number;
    opt23?: number;
    opt24?: number;
    opt25?: number;
    opt26?: number;
    opt27?: number;
    opt28?: number;
    opt29?: number;
    opt30?: number;
    opt31?: number;
    opt32?: number;
    opt33?: number;
    opt34?: number;
    opt35?: number;
    opt36?: number;
    opt37?: number;
    opt38?: number;
    opt39?: number;
    opt40?: number;
    opt41?: number;
    opt42?: number;
    opt43?: number;
    opt44?: number;
    opt45?: number;
    opt46?: number;
    opt47?: number;
    opt48?: number;
    opt49?: number;
    opt50?: number;
    opt51?: number;
    opt52?: number;
    opt53?: number;
    opt54?: number;
    opt55?: number;
    opt56?: number;
    opt57?: number;
    opt58?: number;
    opt59?: number;
    opt60?: number;
    opt61?: number;
    opt62?: number;
    opt63?: number;
    opt64?: number;
    opt65?: number;
    opt66?: number;
    opt67?: number;
    shared?: number;
    zone?: number;
}
interface Narrow {
    kind: "narrow";
    shared?: number;
    size: number;
}
function wide(): Wide {
    return { kind: "wide" };
}
function narrow(size: number): Narrow {
    return { kind: "narrow", size };
}
function fill(made: Wide): void {
    made.opt00 = 1;
    made.opt65 = 2;
    made.shared = 3;
    made.zone = 4;
    (made as any).later = 5;
}
function read(one: Wide | Narrow): number {
    return one.kind === "wide" ? (one.shared ?? 0) + (one.opt65 ?? 0) + (one.zone ?? 0) + (one.opt67 ?? 0) : one.size + (one.shared ?? 0);
}
const left = wide(), filled = wide();
fill(filled);
console.log(read(left), read(filled), read(narrow(7)), Object.keys(filled).join(), "opt67" in filled, "opt65" in filled);

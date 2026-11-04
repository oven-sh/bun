// An optional field is read, and what arrives is one: nobody has asked whether it is a cell.
function show(value: unknown): string {
    return Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" ? typeof value : typeof value === "function" ? "function" : typeof value + ":" + JSON.stringify(value);
}
function attempt(name: string, run: () => unknown) {
    try {
        console.log(name, show(run()));
    } catch (error) {
        console.log(name, "throws", (error as Error).constructor.name);
    }
}
const misfit: any = JSON.parse("1");
class Leaf {
    name: string;
    note?: number;
    constructor(name: string, note?: number) { this.name = name; if (note !== undefined) this.note = note; }
}
function noteOf(leaves: Leaf[]) { return leaves[0].note; }
attempt("as written", () => [noteOf([new Leaf("a", 1)]), noteOf([new Leaf("b")])].join());
attempt("misfit", () => noteOf([misfit]));
attempt("as written again", () => noteOf([new Leaf("c", 3)]));

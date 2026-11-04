// The receiver is the result of a call, and what arrives is negative zero: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("-0");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
const kept: any[] = [];
function latest(): Point { return kept[kept.length - 1]; }
function read() { return latest().x + latest().y; }
function put(value: any) { kept.push(value); return read(); }
attempt("as written", () => put(new Point(1, 2)));
attempt("misfit", () => put(misfit));
attempt("as written again", () => put(new Point(3, 4)));

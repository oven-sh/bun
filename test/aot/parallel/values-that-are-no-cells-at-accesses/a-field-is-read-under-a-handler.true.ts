// A field is read under a handler, and what arrives is true: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("true");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function read(point: Point) {
    let before = "before";
    try {
        before = "in";
        return "read " + point.x;
    } catch (error) {
        return before + " caught " + (error as Error).constructor.name;
    } finally {
        console.log("finally", before);
    }
}
attempt("as written", () => read(new Point(1, 2)));
attempt("misfit", () => read(misfit));
attempt("as written again", () => read(new Point(3, 4)));

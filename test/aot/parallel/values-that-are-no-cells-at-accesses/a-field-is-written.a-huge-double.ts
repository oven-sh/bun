// A field is written, and what arrives is a huge double: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("1e308");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function write(points: Point[], value: number) { points[0].y = value; return points[0]; }
attempt("as written", () => write([new Point(1, 2)], 5).y);
attempt("misfit", () => write([misfit], 5));
attempt("as written again", () => write([new Point(3, 4)], 6).y);

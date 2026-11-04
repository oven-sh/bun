// Fields are read and written, and what arrives is an object of no class: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("{\"x\": 41, \"y\": 42, \"kind\": 9, \"note\": 8}");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function swap(points: Point[]) { const point = points[0]; const x = point.x; point.x = point.y; point.y = x; return point; }
attempt("as written", () => swap([new Point(1, 2)]).x);
attempt("misfit", () => swap([misfit]));
attempt("as written again", () => swap([new Point(3, 4)]).y);

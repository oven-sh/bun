// Fields are read in a loop, and what arrives is null: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("null");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function total(points: Point[]) {
    let sum = 0;
    for (let index = 0; index < points.length; ++index)
        sum += points[index].x + points[index].y;
    return sum;
}
attempt("as written", () => total([new Point(1, 2), new Point(3, 4)]));
attempt("misfit", () => total([new Point(1, 2), misfit, new Point(3, 4)]));
attempt("as written again", () => total([new Point(5, 6)]));

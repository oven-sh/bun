// Many registers are live at the read, and what arrives is false: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("false");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function mix(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, point: Point, i: number, j: number) {
    const early = a * 2 + b * 3 + c * 5 + d * 7;
    let read: unknown = "none";
    try {
        read = point.x;
    } catch (error) {
        read = (error as Error).constructor.name;
    }
    return [early, e * 11 + f * 13 + g * 17 + h * 19 + i * 23 + j * 29, a, b, c, d, e, f, g, h, i, j, show(read)].join();
}
attempt("as written", () => mix(1, 2, 3, 4, 5, 6, 7, 8, new Point(1, 2), 9, 10));
attempt("misfit", () => mix(1, 2, 3, 4, 5, 6, 7, 8, misfit, 9, 10));
attempt("as written again", () => mix(1, 2, 3, 4, 5, 6, 7, 8, new Point(3, 4), 9, 10));

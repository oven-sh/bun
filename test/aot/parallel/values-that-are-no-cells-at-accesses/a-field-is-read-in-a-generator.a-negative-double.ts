// A field is read in a generator, and what arrives is a negative double: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("-123456789.25");
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function* read(point: Point) {
    yield "first";
    yield point.x;
    yield point.y;
}
attempt("as written", () => [...read(new Point(1, 2))].join());
attempt("misfit", () => [...read(misfit)].join());
attempt("as written again", () => [...read(new Point(3, 4))].join());

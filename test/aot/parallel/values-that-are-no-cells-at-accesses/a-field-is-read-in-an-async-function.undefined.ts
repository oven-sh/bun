// A field is read in an async function, and what arrives is undefined: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("{}").missing;
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
async function read(point: Point) {
    await null;
    const x = point.x;
    await null;
    return x + point.y;
}
async function main() {
    for (const [name, value] of [["as written", new Point(1, 2)], ["misfit", misfit], ["as written again", new Point(3, 4)]] as [string, Point][]) {
        try {
            console.log(name, show(await read(value)));
        } catch (error) {
            console.log(name, "throws", (error as Error).constructor.name);
        }
    }
}
main();

// A field of a second family is read, and what arrives is zero: nobody has asked whether it is a cell.
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
const misfit: any = JSON.parse("0");
interface Shape { kind: number; }
class Circle implements Shape { kind = 1; radius = 2; }
class Square implements Shape { kind = 2; side = 3; }
class Triangle implements Shape { kind = 3; base = 4; height = 5; }
class Line implements Shape { kind = 4; length = 6; }
interface Beast { legs: number; }
class Cat implements Beast { legs = 4; name = "cat"; }
class Bird implements Beast { legs = 2; wings = 2; }
class Ant implements Beast { legs = 6; nest = 1; hill = 2; }
function kindOf(shapes: Shape[], index: number) { return shapes[index].kind; }
function kindTwice(shapes: Shape[], index: number) { return shapes[index].kind * 2; }
function kindThrice(shapes: Shape[], index: number) { return shapes[index].kind * 3; }
function legsOf(beasts: Beast[], index: number) { return beasts[index].legs; }
const all: Shape[] = [new Circle, new Square, new Triangle, new Line];
const beasts: Beast[] = [new Cat, new Bird, new Ant];
console.log([0, 1, 2, 3].map(index => kindOf(all, index) + kindTwice(all, index) + kindThrice(all, index)).join());
attempt("as written", () => [0, 1, 2].map(index => legsOf(beasts, index)).join());
attempt("misfit", () => legsOf([misfit], 0));
attempt("as written again", () => [2, 1, 0].map(index => legsOf(beasts, index)).join());

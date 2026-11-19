type Circle = { kind: "circle"; label: string; on: boolean; radius: number; weight: number };
type Square = { kind: "square"; label: string; on: boolean; owner: Circle | null; side: number; tall: number; weight: number };
type Shape = Circle | Square;

function makeCircle(seed: number): Circle {
    return { kind: "circle", label: "circle " + seed, on: (seed & 1) === 1, radius: seed + 0.5, weight: seed };
}

function makeSquare(seed: number, owner: Circle | null): Square {
    return { kind: "square", label: "square " + seed, on: (seed & 2) === 2, owner, side: seed + 0.25, tall: seed + 0.75, weight: seed + 1 };
}

function labelOf(shape: Shape): string {
    return shape.label;
}

function isOn(shape: Shape): boolean {
    return shape.on;
}

function weightOf(shape: Shape): number {
    return shape.weight;
}

function areaOf(shape: Shape): number {
    return shape.kind === "circle" ? shape.radius * shape.radius : shape.side * shape.tall;
}

function turn(shape: Shape, on: boolean, weight: number, label: string): void {
    shape.on = on;
    shape.weight = weight;
    shape.label = label;
}

function show(shape: Shape): string {
    const shared = shape.kind + " " + labelOf(shape) + " " + String(isOn(shape)) + " " + String(weightOf(shape)) + " " + String(areaOf(shape));
    return shape.kind === "square" ? shared + " owned by " + (shape.owner ? shape.owner.label : "nobody") : shared;
}

function collect(): void {
    let garbage: Shape[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(makeCircle(i));
    garbage = [];
    Bun.gc(true);
}

const circle = makeCircle(3);
const square = makeSquare(6, circle);
const alone = makeSquare(7, null);
console.log(show(circle));
console.log(show(square));
console.log(show(alone));
collect();

turn(circle, false, 30, "turned circle");
console.log(show(circle));
console.log(show(square));
turn(square, false, 60, "turned square");
console.log(show(circle));
console.log(show(square));
console.log(show(alone));
collect();
console.log(show(circle));
console.log(show(square));
console.log(Object.keys(circle).join(","), Object.keys(square).join(","));
console.log(JSON.stringify(circle), JSON.stringify(alone));

const shapes: Shape[] = [];
for (let i = 0; i < 300; i++) {
    shapes.push((i & 1) === 1 ? makeCircle(i) : makeSquare(i, (i & 2) === 2 ? makeCircle(i + 1000) : null));
    if (i % 100 === 99)
        collect();
}
let sum = 0;
let letters = 0;
let numberOn = 0;
for (const shape of shapes) {
    sum += weightOf(shape) + areaOf(shape);
    letters += labelOf(shape).length;
    numberOn += isOn(shape) ? 1 : 0;
}
console.log(String(sum), String(letters), String(numberOn));
console.log(show(shapes[101]), "//", show(shapes[102]), "//", show(shapes[104]));

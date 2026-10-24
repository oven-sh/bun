// The family and its call site live in one module. A second module, which is imported in the middle of the program, adds a subclass below an override and replaces the method of the base. Calls before the import find the originals; calls after it find the replacement and the new override.
import { areas, Circle, Dot, Shape } from "./family";

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
console.log("before the import: " + areas(shapes));
let sum = 0;
for (let round = 0; round < 1000; round++) sum += areas(shapes);
console.log("a thousand rounds: " + sum);
const { Ring } = await import("./late");
console.log("after the import: " + areas(shapes));
shapes.push(new Ring(5));
console.log("with an object of the new subclass: " + areas(shapes));
Circle.prototype.area = () => 1;
console.log("after the override in between is replaced: " + areas(shapes));

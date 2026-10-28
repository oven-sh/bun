// Object.setPrototypeOf, Reflect.setPrototypeOf and a store to __proto__ put another object, which has the name of the field that most of them leave empty, above the objects themselves.
import { olds, options, points, round } from "../objects-with-a-field-left-empty";

const above = { late: "text" };
round("before");
Object.setPrototypeOf(options[1], above);
Reflect.setPrototypeOf(points[1], above);
(olds[1] as any).__proto__ = above;
round("one of each");
for (const object of options) Object.setPrototypeOf(object, above);
for (const object of points) Object.setPrototypeOf(object, Object.create(above));
for (const object of olds) Object.setPrototypeOf(object, null);
round("all of them");

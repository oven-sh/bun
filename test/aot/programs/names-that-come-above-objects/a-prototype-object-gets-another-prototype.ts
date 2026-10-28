// The prototype object of a class and of a constructor function get another object above them, which has the name of the field that most objects leave empty.
import { Old, Point, round } from "../objects-with-a-field-left-empty";

const above = { late: { x: "x", y: 2 } };
round("before");
Object.setPrototypeOf(Point.prototype, above);
round("above the class");
(Old as any).prototype.__proto__ = above;
round("above the function's prototype object");
Object.setPrototypeOf(Point.prototype, Object.prototype);
Object.setPrototypeOf((Old as any).prototype, null);
round("taken away");

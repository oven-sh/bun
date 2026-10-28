// Built-in functions that write to an object they are handed put the name of a field that most objects leave empty on prototype objects: Reflect.set with and without a receiver, the `this` of a callback, util.inherits, names out of a Map.
import { inherits } from "node:util";
import { Old, Point, round } from "../objects-with-a-field-left-empty";

round("before");
Reflect.set(Point.prototype, "late", "text");
round("Reflect.set");
delete (Point.prototype as any).late;
Reflect.set({}, "late", 7, (Old as any).prototype);
round("Reflect.set for a receiver");
delete (Old as any).prototype.late;
["late"].forEach(function (this: any, name) {
  this[name] = name;
}, Point.prototype);
round("the `this` of a callback");
delete (Point.prototype as any).late;
for (const [name, value] of new Map(Object.entries({ late: null }))) (Point.prototype as any)[name] = value;
round("names out of a Map");
delete (Point.prototype as any).late;
function Super() {}
Super.prototype.late = { x: 1, y: "y" };
inherits(Old as any, Super as any);
round("util.inherits");

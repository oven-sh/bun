// Object.defineProperty, Object.defineProperties, Reflect.defineProperty and __defineGetter__ put the name of a field that most objects leave empty above the objects: values, getters, and setters that take the stores.
import { Old, Point, round, tried } from "../objects-with-a-field-left-empty";

let taken = 0;
round("before");
Object.defineProperty(Point.prototype, "late", { value: "text", configurable: true, writable: false });
Object.defineProperties((Old as any).prototype, { late: { get: () => 7, configurable: true } });
round("a read-only value and a getter alone");
Reflect.defineProperty(Point.prototype, "late", {
  get() {
    return { x: (this as Point).a, y: "y" };
  },
  set(value) {
    taken++;
  },
  configurable: true,
});
delete (Old as any).prototype.late;
round("a getter and a setter");
console.log(taken);
delete (Point.prototype as any).late;
(Old as any).prototype.__defineGetter__("late", () => "got");
round("__defineGetter__");
(Old as any).prototype.__defineSetter__("late", () => void taken++);
round("__defineSetter__");
console.log(taken);
delete (Old as any).prototype.late;
tried("a getter on Object.prototype", () => (Object.prototype as any).__defineGetter__("late", () => "got"));
tried("a value on Object.prototype", () => Object.defineProperty(Object.prototype, "late", { value: 1, configurable: true }));
console.log(Reflect.defineProperty(Object.prototype, "late", { value: 1, configurable: true }));
round("behind those");

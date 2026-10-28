// The built-in functions that change an object are found under computed names, in a list, bound, and through Reflect.apply and call, and put the name of a field that most objects leave empty above the objects.
import { Old, olds, Point, points, round } from "../objects-with-a-field-left-empty";

const few = process.argv.length < 99;
const word = (...parts: string[]) => parts.join(few ? "" : "-");
round("before");
(Object as any)[word("define", "Property")](Point.prototype, "late", { value: "text", configurable: true, writable: true });
round("Object under a computed name");
delete (Point.prototype as any).late;
(Reflect as any)[word("set", "PrototypeOf")]((Old as any).prototype, { late: 7 });
round("Reflect under a computed name");
Object.setPrototypeOf((Old as any).prototype, Object.prototype);
const list = [Object.freeze, Object.assign, Object.setPrototypeOf];
list[few ? 1 : 0](Point.prototype, { late: [1] });
round("out of a list");
delete (Point.prototype as any).late;
Reflect.apply(list[few ? 2 : 0], undefined, [points[1], { late: null }]);
round("Reflect.apply");
Object.setPrototypeOf.call(undefined, olds[1], { late: "called" });
round("call");
Object.defineProperty.bind(undefined, Point.prototype, "late")({ get: () => "bound", configurable: true });
round("bound");
const climbing = (globalThis as any)[word("Ob", "ject")];
climbing[word("get", "PrototypeOf")](olds[2])[word("la", "te")] = "climbed";
round("all of it under computed names");

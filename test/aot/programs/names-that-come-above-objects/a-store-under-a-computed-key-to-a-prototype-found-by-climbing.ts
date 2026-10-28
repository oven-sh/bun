// The prototypes are found by climbing from the objects, and the name of the field that most objects leave empty comes out of the command line's length.
import { olds, options, points, round, tried } from "../objects-with-a-field-left-empty";

const key = ["late", "early"][process.argv.length > 99 ? 1 : 0];
function top(object: object): any {
  let current = object;
  while (Object.getPrototypeOf(current)) current = Object.getPrototypeOf(current);
  return current;
}

round("before");
Object.getPrototypeOf(points[1])[key] = "text";
(olds[1] as any).__proto__[key] = 7;
round("one step above");
delete Object.getPrototypeOf(points[1])[key];
delete (olds[1] as any).__proto__[key];
tried("at the top", () => (top(options[1])[key] = { x: 1.5, y: "y" }));
round("behind that");
tried("delete at the top", () => delete top(points[1])[key]);
tried("through the constructor", () => ((options[1] as any).constructor.prototype[key] = null));
round("behind that");
tried("delete", () => delete (Object.prototype as any)[key]);
round("behind that");

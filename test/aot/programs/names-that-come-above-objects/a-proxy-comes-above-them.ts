// A proxy comes above the objects, and answers for the name of the field that most of them leave empty.
import { Old, options, Point, round } from "../objects-with-a-field-left-empty";

const log: string[] = [];
const proxy = new Proxy(
  {},
  {
    get(target, key) {
      log.push(`get ${String(key)}`);
      return key === "late" ? "text" : undefined;
    },
    has(target, key) {
      log.push(`has ${String(key)}`);
      return key === "late";
    },
    set(target, key, value, receiver) {
      log.push(`set ${String(key)}`);
      return true;
    },
  },
);
round("before");
Object.setPrototypeOf(Point.prototype, proxy);
round("above the class");
Object.setPrototypeOf((Old as any).prototype, proxy);
Object.setPrototypeOf(options[1], proxy);
round("above the others");
console.log(log.length, log.filter(entry => entry.endsWith(" late")).length);

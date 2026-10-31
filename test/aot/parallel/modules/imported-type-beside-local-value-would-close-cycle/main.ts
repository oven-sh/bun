// The import of a type beside a local value of the same name is dropped. If it were kept, the two files would need each other, and the imported one would read a constant of this one before it is set.
import { Gauge } from "./gauge";
export const first = 10;
const Gauge = { level: first + 1 };
const typed: Gauge = Gauge;
console.log(typed.level);

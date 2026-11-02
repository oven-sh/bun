// The build compiles this program twice: the first time it learns that any member of `console` may be read. Each macro call runs once.
import { count } from "./macro.ts" with { type: "macro" };
const holder = { console };
console.log(count(), count(), typeof holder[process.env.KEY ?? "console"].log);

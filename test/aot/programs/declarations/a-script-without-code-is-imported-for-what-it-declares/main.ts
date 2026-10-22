// Nothing is left of shims.ts at run time, so whether it is a script is a question for the checker alone: `declare module` in it declares a module and adds to none, and its interface is global, as for tsc and `bun check`.
import "./shims";
import { third } from "untyped-thirds";
import thing from "./one.thing";

const size: Size = { width: 9 };
console.log(third(size.width), typeof thing);

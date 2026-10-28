// `Console` of node:console is an interface in the namespace of the exported value and a property of that value at once. A named import of it is a value: it is constructed, tested with typeof and exported again.
import { Console as Other } from "console";
import { Console, type ConsoleOptions, log } from "node:console";
import * as self from "./console-class-through-a-named-import";
export { Console };
const options: ConsoleOptions = { stdout: process.stdout };
const made: Console = new Console(options);
made.log({ a: 1 }, "text", 5);
log(typeof Console, Console === Other, Console === console.Console, Object.keys(self).join(), self.Console === Console);

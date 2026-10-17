// Private fields and methods are added to whatever object a base constructor returns, including typed objects.
declare const console: { log(...values: unknown[]): void };
import { run } from "./untyped.js";
run((line: string) => console.log(line));

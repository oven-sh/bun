// Reference: bun build --compile
import { length } from "./inner/length";
import { marked } from "./legacy/marked";
import { count } from "./standard";
const shown: string = <b>x</b>;
console.log(shown, length, marked, count);

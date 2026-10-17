// `import * as ns` initializes a variable of a record type.
declare const console: { log(...values: unknown[]): void };
import * as ns from "./m.ts";
const a: { programs: number[] } = ns;
console.log(a.programs.length, ns.programs.length + ns.f(1));

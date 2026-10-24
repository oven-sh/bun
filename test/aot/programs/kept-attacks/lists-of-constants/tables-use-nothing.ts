// Lists of constants: tables use nothing. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const key = process.argv[2];
console.log(key ? "x" : "none", 0);

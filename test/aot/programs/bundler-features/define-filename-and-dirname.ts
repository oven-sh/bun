// `--define` replaces `__filename`, `__dirname` and `require`, which no file declares, as it replaces any other free name. `module` and `exports` are variables of the file and stay.
declare const console: { log(...values: unknown[]): void };
declare const __filename: string;
declare const __dirname: string;
function inFunction(): string { return __dirname + "|" + __filename; }
function shadowed(__filename: string): string { return __filename; }
console.log(__filename, __dirname, typeof __filename);
console.log(inFunction(), shadowed("own"));
console.log(__filename.endsWith("tool.js"), __dirname.length);

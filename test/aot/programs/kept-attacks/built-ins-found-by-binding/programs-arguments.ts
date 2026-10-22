// Built ins found by binding: programs arguments. It prints what plain Bun prints.
console.log(process.argv.length, typeof process.argv[0], Array.isArray(process.argv), process.argv.slice(2).join("|"));
console.log(process.argv === process.argv, Bun.argv === process.argv, process.execArgv.length, Array.isArray(process.execArgv));
for (const argument of process.argv.slice(2)) console.log(argument.toUpperCase());
process.argv.push("pushed");
console.log(process.argv.at(-1), Bun.argv.at(-1));
(process as any).argv[0] = 41;
console.log((process as any).argv[0] + 1, (Bun as any).argv[0] + 1);
const replacement = [{ a: 1 }];
(process as any).argv = replacement;
console.log((process as any).argv === replacement, (process as any).argv[0].a, Bun.argv === (process as any).argv);
(process as any).argv = 7;
console.log((process as any).argv + 1);
(process as any).execArgv = "text";
console.log((process as any).execArgv.length);

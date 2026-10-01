// What TypeScript 6.0.2 prints in the plain format for the sample files, byte for byte.
const ts = require("/workspace/wt/cli/node_modules/typescript");
const names = ["a.ts", "chain.ts", "u.ts", "cr.ts", "eof.ts"];
const program = ts.createProgram(names, { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022 });
const diags = ts.sortAndDeduplicateDiagnostics(ts.getPreEmitDiagnostics(program));
const host = { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => "\n" };
process.stdout.write(JSON.stringify(ts.formatDiagnostics(diags, host)) + "\n");

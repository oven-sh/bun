// Checks the types of src/js as the compiler reads it: a module that has a second text in src/js/ahead-of-time is read from there,
// under the name of the first, as `locate` in builtins-manifest-model.ts does. `tsc -p src/js/tsconfig.json` reads both texts, and
// takes what `require` answers from the first. A second text in JavaScript declares no types, so what it exports is taken from the
// first. The first text of a module that has a second one in TypeScript is not read.
import path from "node:path";
import ts from "typescript";

const base = path.join(import.meta.dir, "../js");

function report(diagnostics: readonly ts.Diagnostic[]) {
  if (diagnostics.length === 0) return;
  console.error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => path.join(base, "../.."),
      getNewLine: () => "\n",
    }),
  );
  console.error(`${diagnostics.length} errors`);
  process.exit(1);
}

const config = ts.getParsedCommandLineOfConfigFile(path.join(base, "tsconfig.json"), undefined, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: diagnostic => report([diagnostic]),
})!;
report(config.errors);

const secondTexts = path.join(base, "ahead-of-time") + path.sep;
const secondTextOf = (file: string) => path.join(secondTexts, path.relative(base, file));
const host = ts.createCompilerHost(config.options);
host.readFile = file =>
  ts.sys.readFile(file.endsWith(".ts") && ts.sys.fileExists(secondTextOf(file)) ? secondTextOf(file) : file);

const rootNames = config.fileNames.filter(file => !path.normalize(file).startsWith(secondTexts));
report(ts.getPreEmitDiagnostics(ts.createProgram({ rootNames, options: config.options, host })));

// TypeScript's own checker over generated programs, many at a time, each a module of its own, under the options the product bed builds with. The library files are read once.
//
//   bun test/aot/fuzz/type-check.ts <folder>      checks every .ts file of the folder by itself: prints the errors, and how many files are clean
//
// TypeScript is taken from node_modules, or from the folder that AOT_FUZZ_TYPESCRIPT names (the one that holds its package.json).
import { readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";

/** The errors of each program. */
export type Checker = (texts: string[]) => string[][];

/** Nothing where TypeScript is not installed. */
export function typeChecker(): Checker | undefined {
  let ts: typeof import("typescript");
  try {
    ts = createRequire(import.meta.url)(process.env.AOT_FUZZ_TYPESCRIPT ?? "typescript");
  } catch {
    return;
  }
  const options: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    types: [],
  };
  const libraries = dirname(ts.getDefaultLibFilePath(options));
  const parsed = new Map<string, import("typescript").SourceFile | undefined>();
  const nameOf = (index: number) => `/program${index}.ts`;
  const indexOf = (file: string) => Number(/^\/program(\d+)\.ts$/.exec(file)?.[1] ?? -1);
  let texts: string[] = [];
  const host: import("typescript").CompilerHost = {
    getSourceFile(file, languageVersion) {
      if (indexOf(file) >= 0) return ts.createSourceFile(file, texts[indexOf(file)], languageVersion, true);
      if (!parsed.has(file)) parsed.set(file, ts.sys.fileExists(file) ? ts.createSourceFile(file, ts.sys.readFile(file)!, languageVersion, true) : undefined);
      return parsed.get(file);
    },
    getDefaultLibFileName: () => join(libraries, ts.getDefaultLibFileName(options)),
    getDefaultLibLocation: () => libraries,
    writeFile() {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: file => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: file => indexOf(file) >= 0 || ts.sys.fileExists(file),
    readFile: file => (indexOf(file) >= 0 ? texts[indexOf(file)] : ts.sys.readFile(file)),
  };
  return programs => {
    texts = programs;
    const errors: string[][] = programs.map(() => []);
    for (const { file, start, code, messageText } of ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: programs.map((_, index) => nameOf(index)), options, host })))
      errors[Math.max(0, indexOf(file?.fileName ?? ""))].push(`${file && start !== undefined ? file.getLineAndCharacterOfPosition(start).line + 1 : 0}: TS${code}: ${ts.flattenDiagnosticMessageText(messageText, " ")}`);
    return errors;
  };
}

/** What the rules of the source forbid though the checker takes it: a cast, `any`, `!`, a comment that silences the checker. */
export const writtenEscapes = (text: string) => text.match(/\bas (?!const\b)[A-Za-z{(\[]|(?<![\w"])any\b(?!["\w])|[\w)\]]!(?![=\w])|@ts-\w+/g) ?? [];

if (import.meta.main) {
  const folder = process.argv[2];
  const check = typeChecker();
  if (!check) throw new Error("TypeScript is not installed");
  const files = readdirSync(folder).filter(file => file.endsWith(".ts")).sort(); // prettier-ignore
  let clean = 0;
  const perGroup = new Map<string, [number, number]>();
  for (let from = 0; from < files.length; from += 64) {
    const some = files.slice(from, from + 64);
    const texts = some.map(file => readFileSync(join(folder, file), "utf8"));
    check(texts).forEach((found, index) => {
      const errors = [...found, ...writtenEscapes(texts[index]).map(escape => `0: written out: ${escape}`)];
      const group = some[index].replace(/^\d+-|\.ts$/g, "");
      const counts = perGroup.get(group) ?? perGroup.set(group, [0, 0]).get(group)!;
      counts[0]++;
      if (!errors.length) (clean++, counts[1]++);
      for (const error of errors.slice(0, 3)) console.log(`${some[index]}:${error}`);
    });
  }
  for (const [group, [all, good]] of [...perGroup].sort()) if (good < all) console.log(`${good} of ${all} clean\t${group}`);
  console.log(`${clean} of ${files.length} programs are clean (${((clean / files.length) * 100).toFixed(1)}%)`);
}

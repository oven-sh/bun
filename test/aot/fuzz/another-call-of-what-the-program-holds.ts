// A program calls its functions with the values that its author thought of. Here one or two of its own functions are called once more, ahead of
// everything else that the program does, with values of other kinds: a list of texts where numbers went, a record where an instance went, a
// big integer, nothing at all. Whatever that call does or throws stays inside a try. What is known of a function from all its calls has to hold
// for this one too. In some programs a built-in module is imported as well and never used.
import ts from "typescript";
import { Random } from "./random";

const others = [
  '"1,2,3,4,5,6".split(",")',
  'Object.values(JSON.parse(\'{"a":"1","b":"2","c":"3"}\'))',
  "[1.5, -1.5, 2.5]",
  "[1, 2, 3]",
  '[1, "s", {}]',
  "[]",
  "{}",
  "{ length: 2, 0: 1, 1: 2 }",
  '"a"',
  '"7"',
  "1n",
  "1.5",
  "-0",
  "NaN",
  "2",
  "0",
  "null",
  "undefined",
  "true",
  "() => 1",
  "new Map()",
  "new Set([1])",
  "new (class extends Map {})()",
  "new (class { x = 1; })()",
  "Object.create(null)",
  "new Float64Array(3)",
];

const idle = [
  "fs",
  "path",
  "events",
  "util",
  "os",
  "buffer",
  "stream",
  "url",
  "assert",
  "crypto",
  "zlib",
  "child_process",
  "worker_threads",
];

const isBroken = (source: ts.SourceFile) =>
  (source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0;

/** The program with another call of one or two of its functions, or undefined where it declares none at its top. */
export function withAnotherCall(path: string, text: string, random: Random): string | undefined {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (isBroken(source)) return undefined;
  const isTyped = /\.[cm]?tsx?$/.test(path);
  const declared = source.statements.filter(
    (statement): statement is ts.FunctionDeclaration & { name: ts.Identifier } =>
      ts.isFunctionDeclaration(statement) &&
      !!statement.name &&
      !!statement.body &&
      statement.parameters.length > 0 &&
      !statement.asteriskToken,
  );
  if (!declared.length) return undefined;
  // Function declarations are there from the start, but what they name may not be: the call stands behind the last declaration of the top.
  const isDeclaration = (statement: ts.Statement) =>
    ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement) || ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement); // prettier-ignore
  const first = source.statements.find(statement => !isDeclaration(statement));
  if (!first) return undefined;
  const given = (value: string) => (isTyped ? `(${value}) as any` : value);
  const calls = random.sample(declared, Math.min(declared.length, random.between(1, 2))).map(called => {
    // Most parameters keep a small number, so that what counts turns goes on counting them. One or two get another kind.
    const odd = new Set(
      random.sample([...called.parameters.keys()], Math.min(called.parameters.length, random.between(1, 2))),
    );
    const handed = called.parameters.map((_, index) =>
      given(odd.has(index) ? random.pick(others) : random.pick(["2", "1", "3", "0"])),
    );
    const count = random.chance(0.15) ? random.between(0, handed.length - 1) : handed.length;
    return `try {\n  ${called.name.text}(${handed.slice(0, count).join(", ")});\n} catch {}\n`;
  });
  const at = first.getStart(source);
  const imported = random.chance(0.3) ? `import "node:${random.pick(idle)}";\n` : "";
  // An import statement makes the file an ES module, which may not name what only a CommonJS file has.
  const namesCommonJS = /\b(module|exports|require|__dirname|__filename)\b/.test(text);
  const written = (namesCommonJS ? "" : imported) + text.slice(0, at) + calls.join("") + text.slice(at);
  return isBroken(ts.createSourceFile(path, written, ts.ScriptTarget.Latest, true)) ? undefined : written;
}

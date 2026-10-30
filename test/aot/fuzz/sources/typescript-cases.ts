// TypeScript's own compiler and conformance tests as programs: some 9,000 pieces of real TypeScript that somebody else wrote. They come from test/cli/check/typescript-go/bundle.zst, where
// `bun check` already compares its diagnostics with typescript-go's. Seed n draws case n. A case that the build refuses counts as skipped: many are written to be refused, and each is built
// under the options in its own first lines. Most cases print nothing, so this mainly finds builds that stop or crash, and exceptions that only the compiled program throws.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asProgram, type Drawn } from "../family";

const casesRoot = "/_submodules/TypeScript/tests/cases/";

/**
 * Cases that say nothing about the compiler, because `bun <file>` is no yardstick for them. In all but the last plain Bun's own transpiler departs from what TypeScript means, and the
 * executable does what TypeScript means. A case that begins to agree costs nothing here; one that is missing shows up as a find, is looked at once, and is added with its kind.
 */
const plainBunIsNoYardstick = new Set([
  // `import require = require(..)`
  "compiler/collisionExportsRequireAndAlias.ts",
  // the text of a function is printed
  "compiler/collisionThisExpressionAndLocalVarInLambda.ts",
  "compiler/noCollisionThisExpressionAndLocalVarInLambda.ts",
  // `continue` to the outer of two labels of one endless loop
  "compiler/continueTarget3.ts",
  "conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueTarget3.ts",
  // an enum as the one statement of an `if` or a loop
  "compiler/elidedEmbeddedStatementsReplacedWithSemicolon.ts",
  "conformance/constEnums/constEnum4.ts",
  // an import, export or alias of a type
  "compiler/es6ExportClauseWithoutModuleSpecifier.ts",
  "compiler/es6ExportClauseWithoutModuleSpecifierInEs5.ts",
  "conformance/es6/modules/exportsAndImports1-es6.ts",
  "conformance/es6/modules/exportsAndImports1.ts",
  "conformance/es6/modules/exportsAndImports3-es6.ts",
  "conformance/es6/modules/exportsAndImports3.ts",
  // a local variable named as the namespace around it
  "compiler/nameCollisionWithBlockScopedVariable1.ts",
  // an enum member named by a reserved word of strict code
  "compiler/strictModeEnumMemberNameReserved.ts",
  "conformance/parser/ecmascript5/EnumDeclarations/parserInterfaceKeywordInEnum1.ts",
  // a static member named `prototype` in an ambient class
  "conformance/classes/propertyMemberDeclarations/staticPropertyNameConflictsInAmbientContext.ts",
  // decorators: a private name in an operand, an `accessor` field under experimentalDecorators, a decorated class that names itself
  "conformance/decorators/class/method/decoratorOnClassMethod19.ts",
  "conformance/decorators/class/property/decoratorOnClassProperty13.ts",
  "conformance/decorators/legacyDecorators-contextualTypes.ts",
  "conformance/esDecorators/classDeclaration/esDecorators-classDeclaration-outerThisReference.ts",
  "conformance/esDecorators/classExpression/namedEvaluation/esDecorators-classExpression-namedEvaluation.9.ts",
  // it prints Math.random()
  "compiler/controlFlowFinallyNoCatchAssignments.ts",
]);

// Directives that need a different module system, extra inputs or a non-default library.
const skippedDirective =
  /^\s*\/\/\s*@(jsx|module\s*:\s*(amd|system|umd)|outfile|noLib|lib\s*:|allowJs|checkJs|emitDeclarationOnly|moduleResolution|paths|baseUrl|types\b|typeRoots)/im;
const booleanOptions = new Map(
  [
    "strict",
    "noImplicitAny",
    "strictNullChecks",
    "strictPropertyInitialization",
    "strictFunctionTypes",
    "strictBindCallApply",
    "noImplicitThis",
    "alwaysStrict",
    "useDefineForClassFields",
    "exactOptionalPropertyTypes",
    "noUncheckedIndexedAccess",
    "experimentalDecorators",
    "emitDecoratorMetadata",
    "useUnknownInCatchVariables",
    "noImplicitOverride",
    "noPropertyAccessFromIndexSignature",
    "allowUnreachableCode",
    "allowUnusedLabels",
    "noImplicitReturns",
    "noFallthroughCasesInSwitch",
    "noUnusedLocals",
    "noUnusedParameters",
    "preserveConstEnums",
    "isolatedModules",
    "verbatimModuleSyntax",
    "erasableSyntaxOnly",
  ].map(name => [name.toLowerCase(), name]),
);

function readCases(): [name: string, source: string][] {
  const bytes = Buffer.from(
    Bun.zstdDecompressSync(readFileSync(join(import.meta.dir, "../../../cli/check/typescript-go/bundle.zst"))),
  );
  const cases: [string, string][] = [];
  for (let at = 0; at < bytes.length; ) {
    const end = bytes.indexOf(10, at);
    const header = bytes.toString("utf8", at + 4, end);
    const space = header.lastIndexOf(" ");
    const [path, length] = [header.slice(0, space), Number(header.slice(space + 1))];
    if (path.startsWith(casesRoot) && path.endsWith(".ts") && !path.endsWith(".d.ts"))
      cases.push([path.slice(casesRoot.length), bytes.toString("utf8", end + 1, end + 1 + length)]);
    at = end + 1 + length + 1;
  }
  return cases.filter(([name, source]) => !plainBunIsNoYardstick.has(name) && !skippedDirective.test(source));
}

function compilerOptions(source: string) {
  const options: Record<string, unknown> = { types: [] };
  for (const [, name, value] of source.matchAll(/^\s*\/\/\s*@(\w+)\s*:\s*([^\r\n]*)/gm)) {
    const option = booleanOptions.get(name.toLowerCase());
    const first = value.split(",")[0].trim().toLowerCase();
    if (option && (first === "true" || first === "false")) options[option] = first === "true";
  }
  return options;
}

/** The files of a case. Its last file is what runs. Nothing where it has inputs other than TypeScript modules, where the file that runs lies in a folder of its own, or where another file imports it. */
function filesOf(source: string) {
  const pieces = source.split(/^\s*\/\/\s*@filename\s*:\s*([^\r\n]+)\r?\n/im);
  const files: [string, string][] = [];
  for (let i = 1; i < pieces.length; i += 2) files.push([pieces[i].trim().replace(/^\/+/, ""), pieces[i + 1]]);
  if (!files.length) files.push(["main.ts", source]);
  if (files.some(([name]) => name.includes("..") || !/\.(ts|mts|cts)$/.test(name))) return;
  const [file, text] = files.pop()!;
  const runs = `main.${file.split(".").at(-1)}`;
  const stem = `./${file.slice(0, file.lastIndexOf("."))}`;
  if (
    file.includes("/") ||
    file.endsWith(".d.ts") ||
    files.some(([name, other]) => name === runs || other.includes(stem))
  )
    return;
  const listed = [runs, ...files.map(([name]) => name).filter(name => name.endsWith(".d.ts"))];
  return {
    file,
    text,
    files: {
      ...Object.fromEntries(files),
      "tsconfig.json": JSON.stringify({ compilerOptions: compilerOptions(source), files: listed }),
    },
  };
}

let cases: [name: string, source: string][] | undefined;
const drawn: Drawn = (seed, bed) => {
  if (bed.name !== "product") return;
  cases ??= readCases();
  const [name, source] = cases[seed % cases.length];
  const made = filesOf(source);
  const program = made && asProgram(made);
  return (
    program && {
      seed,
      ...program,
      notes: name,
      group: name.split("/").slice(0, 2).join("/"),
      standsAlone: true,
      mayBeRefused: true,
    }
  );
};
export default drawn;

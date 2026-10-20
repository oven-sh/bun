// builtin-parser.ts is a tokenizer. When it reads a literal as code, or code as a literal, the output still bundles.
import ts from "typescript";

const literal_kinds = new Set([
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

// The `$debug` and `$assert` macros expand to calls of these.
const kept_names = new Set(["$debug_log", "$assert"]);

const isNew = (node: ts.Node, name: string) =>
  ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
const isDefault = (modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword;

/** What the preprocessor did wrong at `node`: a rewrite inside a literal, or code it left as written. */
function problemAt(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (literal_kinds.has(node.kind)) {
    return node.getText(sourceFile).includes("__intrinsic__") ? "rewrote text inside this literal" : undefined;
  }
  if (ts.isIdentifier(node)) {
    return /^\$\w/.test(node.text) && !kept_names.has(node.text) ? "did not rewrite this `$name`" : undefined;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return "did not replace this require()";
  }
  if (ts.isExportAssignment(node) || (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(isDefault))) {
    return "did not rewrite this `export default`";
  }
  if (isNew(node, "TypeError")) return "did not rewrite this `new TypeError`";
  if (ts.isThrowStatement(node) && isNew(node.expression, "RangeError")) {
    return "did not rewrite this `throw new RangeError`";
  }
}

/** Throws if the preprocessor rewrote text inside a literal of `text`, or left code that it rewrites as written. */
export function checkPreprocessedSource(fileName: string, text: string, firstLine = 1) {
  const kind = fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    const problem = problemAt(node, sourceFile);
    if (problem) {
      const nodeText = node.getText(sourceFile);
      // A template literal can span many lines. Report the line of the rewrite in it, and show that line.
      const offset = literal_kinds.has(node.kind) ? nodeText.indexOf("__intrinsic__") : 0;
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile) + offset);
      const [shown] = nodeText.slice(nodeText.lastIndexOf("\n", offset) + 1).split("\n", 1);
      // A line of `text` is a line of the source. A column is not: a rewrite moves what follows it on the line.
      problems.push(`${fileName}:${line + firstLine}: the preprocessor ${problem}: ${shown.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (problems.length) {
    throw new Error(
      problems.join("\n") +
        "\nbuiltin-parser.ts is not a parser. It misread the source at or before each place. src/js/README.md lists what it misreads." +
        "\nIf that is a `/`: move the regex literal to its own statement, `const re = /.../;`, or put the left side of the division in parentheses.",
    );
  }
}

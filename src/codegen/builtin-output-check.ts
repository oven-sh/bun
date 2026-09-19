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

/** Throws if the preprocessor rewrote a `$name` inside a literal of `text`, or left a `$name` in its code. */
export function checkPreprocessedSource(fileName: string, text: string, firstLine = 1) {
  const kind = fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    let problem: string | undefined;
    if (literal_kinds.has(node.kind) && node.getText(sourceFile).includes("__intrinsic__")) {
      problem = "the preprocessor rewrote a `$name` inside this literal";
    } else if (ts.isIdentifier(node) && /^\$\w/.test(node.text) && !kept_names.has(node.text)) {
      problem = "the preprocessor did not rewrite this `$name`";
    }
    if (problem) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      problems.push(`${fileName}:${line + firstLine}:${character + 1}: ${problem}: ${node.getText(sourceFile)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (problems.length) {
    throw new Error(
      problems.join("\n") +
        "\nbuiltin-parser.ts is not a parser. It misread a `/` at or before each place: src/js/README.md lists what it misreads." +
        "\nMove a regex literal to its own statement, `const re = /.../;`. Put the left side of a division in parentheses.",
    );
  }
}

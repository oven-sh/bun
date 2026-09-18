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
      problem = "the preprocessor read this literal as code and rewrote a `$name` in it";
    } else if (ts.isIdentifier(node) && /^\$\w/.test(node.text) && !kept_names.has(node.text)) {
      problem = "the preprocessor read this code as a literal and did not rewrite `" + node.text + "`";
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
        "\nbuiltin-parser.ts is not a parser. Move the literal to where it reads right, for example `const re = /.../;`.",
    );
  }
}

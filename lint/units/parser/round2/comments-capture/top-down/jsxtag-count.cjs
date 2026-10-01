// Counts the comments that Bun's next_inside_jsx_element scans: the trivia before a token of a JSX tag other than one inside {...} or <type arguments>.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.js$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  const K = ts.SyntaxKind;
  const found = new Map();
  const isTag = n => n.kind === K.JsxOpeningElement || n.kind === K.JsxSelfClosingElement || n.kind === K.JsxClosingElement || n.kind === K.JsxOpeningFragment || n.kind === K.JsxClosingFragment;
  const visit = n => {
    if (isTag(n)) {
      // tokens of the tag itself, and of its attributes and tag name, but nothing inside an expression container or a type argument
      const walk = (m, top) => {
        if (m.kind === K.JsxExpression || m.kind === K.JsxSpreadAttribute) {
          // the "{" is a token of the tag: the trivia before it is read inside the tag
          for (const r of ts.getLeadingCommentRanges(text, m.pos) || []) found.set(r.pos, r);
          return;
        }
        if (!top && m.parent && m.parent.typeArguments && m.parent.typeArguments.includes(m)) return;
        const kids = m.getChildren(sf);
        if (kids.length === 0) {
          for (const r of ts.getLeadingCommentRanges(text, m.pos) || []) found.set(r.pos, r);
        }
        for (const c of kids) walk(c, false);
      };
      walk(n, true);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const lines = [...found.values()].map(r => sf.getLineAndCharacterOfPosition(r.pos).line + 1).sort((a, b) => a - b);
  console.log(file.split("/").slice(-2).join("/"), "comments read inside JSX tags:", found.size, "lines", JSON.stringify(lines));
}

// node directives-parse.cjs : sources whose comments only a parse can tell (JSX tags, JSX text, templates, attempts), with the
// directives of TypeScript 6.0.2. tsc keeps what an attempt scanned (`raw` counts them); typescript-go rewinds its list, so each is printed once.
const fs = require("fs");
const path = require("path");
const ts = require(process.env.ORACLE_TYPESCRIPT || "/workspace/bun/node_modules/typescript");
const upstream = fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/conformance/directives/multiline.tsx", "utf8").replace(/\r\n/g, "\n");
const inputs = [
  ["upstream-multiline-a.ts", upstream.split("// @filename: a.ts\n")[1].split("// @filename: b.tsx\n")[0]],
  ["upstream-multiline-b.tsx", upstream.split("// @filename: b.tsx\n")[1].replace(/^\/\/ @jsx: react\n/, "")],
  ["jsx-tag-comments.tsx", "let e = <div // @ts-ignore\n  a=\"b\" /* @ts-expect-error */\n/>;\n"],
  ["jsx-attr-value-comment.tsx", "let e = <a b= /* @ts-ignore */ \"x\" c={ // @ts-expect-error\n 1} />;\n"],
  ["jsx-closing-tag-comment.tsx", "let e = <a></a // @ts-ignore\n>;\n"],
  ["jsx-text-is-no-comment.tsx", "let e = <a>// @ts-ignore\n/* @ts-expect-error */</a>;\n"],
  ["jsx-expression-comments.tsx", "let e = <a>{/* @ts-ignore */}{// @ts-expect-error\n}</a>;\n"],
  ["jsx-fragment-text.tsx", "let e = <>/* @ts-ignore */</>; // @ts-expect-error\n"],
  ["jsx-after-child-element.tsx", "let e = <a><b/>// @ts-ignore\n<b></b>/* @ts-ignore */</a>;\n"],
  ["jsx-self-closing-then-comment.tsx", "let e = <a/> // @ts-ignore\n;\n"],
  ["tsx-generic-arrow-lookahead.tsx", "const f = <T,>(x: T) /* @ts-ignore */ => x; // @ts-expect-error\n"],
  ["template-and-regex.ts", "let t = `// @ts-ignore ${ /* @ts-expect-error */ 1 } /* @ts-ignore */`; let r = /\\/\\/ @ts-ignore/;\n"],
  ["string.ts", "let s = '// @ts-ignore'; let u = \"/* @ts-expect-error */\";\n"],
  ["arrow-return-type-attempt.ts", "let r = c ? (a) /* @ts-ignore */ : b => d /* @ts-expect-error */ : e;\n"],
  ["type-arguments-attempt.ts", "let r = a < /* @ts-ignore */ b > /* @ts-expect-error */ c;\n"],
];
fs.writeFileSync(path.join(__dirname, "directives-parse-inputs.json"), JSON.stringify(inputs, null, 1) + "\n");
for (const [name, source] of inputs) {
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const kind = name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, false, kind);
  const raw = sf.commentDirectives || [];
  const seen = new Set();
  console.log(`--- ${name} bytes=${Buffer.byteLength(source)} parseDiagnostics=${sf.parseDiagnostics.length} raw=${raw.length}`);
  for (const d of raw) { const k = `directive ${d.type === 0 ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`; if (!seen.has(k)) { seen.add(k); console.log(k); } }
}

// node brief.cjs : the cases of the brief, as TypeScript 6.0.2 reads them (UTF-8 byte offsets), and hex files for the Go oracles.
const fs = require("fs");
const ts = require("/workspace/bun/node_modules/typescript");
const D = [
  ["d-line-ignore", "// @ts-ignore\nlet x: number = 'a';"],
  ["d-triple-slash-ignore", "/// @ts-ignore\nx;"],
  ["d-expect-error-reason", "//@ts-expect-error: reason\nx;"],
  ["d-block-last-line", "/*\n * @ts-ignore */\nx;"],
  ["d-block-first-line-only", "/* @ts-ignore\n */\nx;"],
  ["d-block-one-line", "/* @ts-expect-error */\nx;"],
  ["d-words-before-at-line", "// see @ts-ignore\nx;"],
  ["d-words-before-at-block", "/* x @ts-ignore */\nx;"],
  ["d-crlf", "// @ts-ignore\r\nx;\r\n/*\r\n @ts-expect-error */\r\ny;\r\n"],
  ["d-after-code", "x; // @ts-ignore\ny; /* @ts-expect-error */ z;\n"],
  ["d-four-slashes", "//// @ts-ignore\nx;"],
  ["d-nbsp-before-at", "//\u00a0@ts-ignore\nx;"],
  ["d-prefix-only", "// @ts-ignoreXYZ\n// @ts-expect-errors\nx;"],
  ["d-upper-case", "// @TS-IGNORE\nx;"],
  ["d-jsdoc-last-line", "/**\n * text\n * @ts-expect-error */\nx;"],
  ["d-ls-in-block", "/* a\u2028 @ts-ignore */\nx;"],
  ["d-eof-no-newline", "x;\n// @ts-ignore"],
];
const P = [
  ["p-path", "/// <reference path=\"a.ts\" />\nx;"],
  ["p-types", "/// <reference types=\"node\" />\nx;"],
  ["p-lib-double", "/// <reference lib=\"es2015\" />\nx;"],
  ["p-lib-single", "/// <reference lib='dom' />\nx;"],
  ["p-mode-import", "/// <reference types=\"a\" resolution-mode=\"import\" />\nx;"],
  ["p-mode-require", "/// <reference types=\"a\" resolution-mode=\"require\" />\nx;"],
  ["p-mode-other", "/// <reference types=\"a\" resolution-mode=\"node\" />\nx;"],
  ["p-preserve", "/// <reference path=\"a.ts\" preserve=\"true\" />\nx;"],
  ["p-preserve-false", "/// <reference lib=\"dom\" preserve=\"false\" />\nx;"],
  ["p-no-default-lib", "/// <reference no-default-lib=\"true\" />\nx;"],
  ["p-no-default-lib-false", "/// <reference no-default-lib=\"false\" />\nx;"],
  ["p-no-argument", "/// <reference />\nx;"],
  ["p-no-argument-unclosed", "/// <reference\nx;"],
  ["p-after-first-token", "x;\n/// <reference path=\"a.ts\" />\n// @ts-nocheck\n"],
  ["p-nocheck-then-check", "// @ts-nocheck\n// @ts-check\nx;"],
  ["p-check-then-nocheck", "// @ts-check\n// @ts-nocheck\nx;"],
  ["p-nocheck-alone", "// @ts-nocheck\nx;"],
  ["p-crlf", "/// <reference path=\"a.ts\" />\r\n// @ts-nocheck\r\nx;\r\n"],
  ["p-shebang", "#!/usr/bin/env bun\n/// <reference types=\"bun\" />\n// @ts-check\nx;"],
  ["p-shebang-crlf", "#!/usr/bin/env bun\r\n/// <reference lib=\"dom\" />\r\nx;"],
  ["p-two-slashes-reference", "// <reference path=\"a.ts\" />\nx;"],
  ["p-four-slashes-reference", "//// <reference path=\"a.ts\" />\nx;"],
  ["p-block-reference", "/* <reference path=\"a.ts\" /> */\nx;"],
  ["p-block-nocheck", "/* @ts-nocheck */\nx;"],
  ["p-triple-slash-nocheck", "/// @ts-nocheck\nx;"],
  ["p-nocheck-reason", "// @ts-nocheck: because\nx;"],
  ["p-nocheck-upper", "// @TS-NOCHECK\nx;"],
  ["p-nocheck-suffix", "// @ts-nocheckx\nx;"],
  ["p-upper-tag", "/// <REFERENCE PATH=\"a.ts\" />\nx;"],
  ["p-duplicate-argument", "/// <reference path=\"a.ts\" path=\"b.ts\" />\nx;"],
  ["p-types-lib-path", "/// <reference path=\"p\" lib=\"l\" types=\"t\" />\nx;"],
  ["p-unknown-argument", "/// <reference foo=\"bar\" />\nx;"],
  ["p-unquoted", "/// <reference path=a.ts />\nx;"],
  ["p-unclosed-quote", "/// <reference path=\"a.ts />\nx;"],
  ["p-empty-value", "/// <reference path=\"\" />\nx;"],
  ["p-after-blank-lines-and-comments", "\n\n// a\n/* b */\n/// <reference path=\"a.ts\" />\nx;"],
  ["p-two-errors", "/// <reference />\n/// <reference foo=\"1\" />\nx;"],
  ["p-mode-without-types", "/// <reference path=\"a\" resolution-mode=\"bad\" />\nx;"],
  ["p-no-default-lib-with-types", "/// <reference no-default-lib=\"true\" types=\"a\" />\nx;"],
  ["p-jsx-block", "/** @jsx h */\n/* @jsxFrag Fragment */\n/** @jsxImportSource preact */\n/** @jsxRuntime automatic */\nx;"],
  ["p-jsx-line", "// @jsx h\nx;"],
  ["p-only-header-no-token", "/// <reference path=\"a.ts\" />"],
  ["p-bom", "\ufeff/// <reference path=\"a.ts\" />\nx;"],
];
const hex = s => Buffer.from(s, "utf8").toString("hex");
fs.writeFileSync("/tmp/b1dp/brief-d.hex", D.map(([n, s]) => `${n}\t${hex(s)}`).join("\n") + "\n");
fs.writeFileSync("/tmp/b1dp/brief-p.hex", P.map(([n, s]) => `${n}\t${hex(s)}`).join("\n") + "\n");
const show = (name, source) => {
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  console.log(`--- ${name} ${JSON.stringify(source)}`);
  for (const d of sf.commentDirectives || []) console.log(`directive ${d.type === 0 ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`);
  const pr = [];
  sf.pragmas.forEach((v, k) => { for (const e of Array.isArray(v) ? v : [v]) pr.push([e.range.pos, `pragma ${k} ${b(e.range.pos)}..${b(e.range.end)} ${e.range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "S" : "M"} ${JSON.stringify(e.arguments)}`]); });
  pr.sort((a, c) => a[0] - c[0]);
  for (const [, l] of pr) console.log(l);
  if (sf.checkJsDirective) console.log(`check ${sf.checkJsDirective.enabled ? 1 : 0} ${b(sf.checkJsDirective.pos)}..${b(sf.checkJsDirective.end)}`);
  const mode = m => m === undefined ? "none" : m === ts.ModuleKind.ESNext ? "import" : m === ts.ModuleKind.CommonJS ? "require" : String(m);
  for (const r of sf.referencedFiles) console.log(`path ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0} ${JSON.stringify(r.fileName)}`);
  for (const r of sf.typeReferenceDirectives) console.log(`types ${b(r.pos)}..${b(r.end)} mode=${mode(r.resolutionMode)} preserve=${r.preserve ? 1 : 0} ${JSON.stringify(r.fileName)}`);
  for (const r of sf.libReferenceDirectives) console.log(`lib ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0} ${JSON.stringify(r.fileName)}`);
  if (sf.hasNoDefaultLib) console.log(`hasNoDefaultLib`);
  for (const d of sf.parseDiagnostics) console.log(`diag TS${d.code} ${b(d.start)}..${b(d.start + d.length)} ${JSON.stringify(ts.flattenDiagnosticMessageText(d.messageText, "\n"))}`);
};
for (const [n, s] of process.argv[2] === "p" ? P : D) show(n, s);

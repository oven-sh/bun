// Probe: in TypeScript-family files, does a comment that typescript-go parses lazily (the scanner saw no @see and no @link) ever
// contain a link node? Only then can the order of JSDoc() and EagerJSDoc() calls be observed. Also counts the lazy and eager hosts.
import fs from "node:fs";
import { dumpFiles } from "./dump-ast.ts";
import { inflate, convert } from "./convert.mjs";
const dirs = [["/tmp/tsimp/corpus", /\.(ts|tsx|mts|cts)$/], ["/workspace/ref/typescript-go/internal/bundled/libs", /\.d\.ts$/]] as const;
let files = 0, hostsFlagged = 0, hostsWithJsdoc = 0, eagerHosts = 0, lazyHosts = 0, lazyWithLink = 0, deprecatedFlag = 0, deprecatedTagLazy = 0, flaggedNoComment = 0, eagerNoJsdoc = 0, funcLikeLazy = 0;
const ex: string[] = [];
const FUNCTION_LIKE = new Set(["MethodSignature", "CallSignature", "ConstructSignature", "IndexSignature", "FunctionType", "ConstructorType", "Constructor", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "GetAccessor", "SetAccessor", "FunctionDeclaration"]);
for (const [dir, re] of dirs) for (const name of fs.readdirSync(dir).sort()) {
  if (!re.test(name)) continue;
  files++;
  const bundle = JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + name, text: fs.readFileSync(dir + "/" + name, "utf8") }])));
  const d = bundle.files[0];
  const root = convert(inflate(bundle, d), { isJS: false, textBytes: Buffer.from(d.text, "utf8") });
  (function walk(g: any) {
    const info = g.tsNode?.jsdocInfo ?? 0;
    if (info & 1) {
      hostsFlagged++;
      if (info & 2) deprecatedFlag++;
      if (g.jsdoc.length === 0) { flaggedNoComment++; if (info & 4) eagerNoJsdoc++; }
      else {
        hostsWithJsdoc++;
        let link = false, dep = false;
        for (const j of g.jsdoc) (function w(x: any) { if (/^JSDocLink/.test(x.kind)) link = true; if (x.kind === "JSDocDeprecatedTag") dep = true; for (const c of x.children.values()) { if (c.list) for (const y of c.nodes) w(y); else w(c); } })(j);
        if (info & 4) eagerHosts++;
        else { lazyHosts++; if (FUNCTION_LIKE.has(g.kind)) funcLikeLazy++; if (link) { lazyWithLink++; if (ex.length < 5) ex.push(`${name} Kind${g.kind}[${g.pos},${g.end})`); } if (dep && !(info & 2)) deprecatedTagLazy++; }
      }
    }
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x); else walk(c); }
  })(root);
}
console.log(`files ${files}; hosts with the HasJSDoc flag ${hostsFlagged} (no comment range for the host ${flaggedNoComment}, of them with @see or @link ${eagerNoJsdoc}); hosts with JSDoc ${hostsWithJsdoc}: parsed with the file ${eagerHosts}, parsed on demand ${lazyHosts} (function-like ${funcLikeLazy}); on-demand comments that contain a link node ${lazyWithLink}; hosts with the deprecated flag ${deprecatedFlag}; on-demand comments with a @deprecated tag that the scanner did not flag ${deprecatedTagLazy}`);
for (const e of ex) console.log("  ", e);

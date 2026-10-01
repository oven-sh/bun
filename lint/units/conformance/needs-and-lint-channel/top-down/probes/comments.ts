import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function* walk(d: string): Generator<string> {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}
const SRC_EXT = /\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
function isCommentLine(line: string) {
  const t = line.trimStart();
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*")) return true;
  if (t === "*" || t === "*/" || t.startsWith("* ")) return true;
  return false;
}
function scan(label: string, dirs: string[], extOnly: boolean) {
  let files = 0, srcExt = 0, withRun = 0, withSlashRun = 0, runs = 0, withWord = 0, withWordB = 0, directiveOnlyRuns = 0;
  const words: Record<string, number> = {};
  for (const d of dirs) for (const f of walk(d)) {
    files++;
    if (!SRC_EXT.test(f)) { if (extOnly) continue; } else srcExt++;
    const text = readFileSync(f).toString("latin1");
    const lines = text.split("\n");
    let cur = 0, slash = 0, any = false, anySlash = false, fileRuns = 0;
    const flush = () => { if (cur >= 2) { any = true; fileRuns++; } if (slash >= 2) anySlash = true; cur = 0; slash = 0; };
    for (const l of lines) {
      if (isCommentLine(l)) { cur++; if (l.trimStart().startsWith("//")) slash++; else { if (slash >= 2) anySlash = true; slash = 0; } }
      else flush();
    }
    flush();
    if (any) withRun++;
    if (anySlash) withSlashRun++;
    runs += fileRuns;
    const m = text.match(/TODO|FIXME|XXX|HACK/g);
    if (m) { withWord++; for (const w of m) words[w] = (words[w] ?? 0) + 1; }
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(text)) withWordB++;
  }
  console.log(label, JSON.stringify({ files, withSourceExtension: srcExt, filesWithRunOf2CommentLines: withRun, filesWithRunOf2SlashLines: withSlashRun, runs, filesWithTodoWord: withWord, filesWithTodoWordAtWordBoundary: withWordB, words }));
}
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/";
scan("cases", [TS + "tests/cases/conformance", TS + "tests/cases/compiler"], true);
scan("tests/lib", [TS + "tests/lib"], true);
scan("bundled libs", ["/workspace/ref/typescript-go/internal/bundled/libs"], true);

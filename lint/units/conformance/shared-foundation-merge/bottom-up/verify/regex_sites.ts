// Every regexp of the assembled runner that ports a regexp of Go has the source that re2.ts composes from the proven classes,
// and every other regexp with a class or a flag that Go reads in another way is a known place that ports no regexp of Go.
// usage: bun regex_sites.ts <assembled tree>      exit code 1 when a place differs or is not known
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sites } from "./re2";

const runner = join(process.argv[2], "test/cli/lint/conformance/runner");
let bad = 0;
for (const [file, before, source, flags] of sites) {
  const text = readFileSync(join(runner, file), "utf8");
  // The literal stands after the name on the same line or, where the line is long, on the next one.
  const head = before.trimEnd();
  const at = text.indexOf(head);
  if (at < 0) {
    console.log(`FAIL ${file}: no ${JSON.stringify(head)}`);
    bad++;
    continue;
  }
  const rest = text.slice(at + head.length).trimStart();
  const literal = rest.slice(0, rest.indexOf("\n")).replace(/[;,]$/, "");
  const re = new Function("return " + literal)() as RegExp;
  const same = re instanceof RegExp && re.source === source && re.flags === flags;
  console.log(`${same ? "ok  " : "FAIL"} ${file}: ${before.trim().replace(/\s*[=:]$/, "")} is ${literal}`);
  if (!same) {
    console.log(`     wanted /${source}/${flags}`);
    bad++;
  }
}

// Lines with \s, \S, \w, \W, \b, \B or a literal with the flag i or m: [file, text of the line, why it is no port of a regexp of Go].
const known: [file: string, part: string, why: string][] = [
  ["diagnosticwriter.ts", `.replace(/\\S/g, " ")`, "formatCodeSpan of TypeScript's program.ts, rules tsc, on a JavaScript string"],
  ["error_baseline.ts", "const diagnosticsLocationPrefixTsc = /^(lib.*\\.d\\.ts)\\(\\d+,\\d+\\)/gim;", "harnessIO.ts of TypeScript, rules tsc"],
  ["error_baseline.ts", "const diagnosticsLocationPatternTsc = /(lib.*\\.d\\.ts):\\d+:\\d+/i;", "harnessIO.ts of TypeScript, rules tsc"],
  ["text_model.ts", `blankNonWhitespace: slice => slice.replace(/\\S/g, " "),`, "harnessIO.ts of TypeScript, the model of rules tsc"],
  ["text_model.ts", "squigglePattern: /^\\s*~*$/,", "the reader's inverse of the line above, the model of rules tsc"],
  ["reader.ts", "const plainHead = /^(\\S.*?)\\(", "reader of a baseline; on a byte string no first byte of a name is a space of JavaScript"],
  ["reader.ts", "const gutterSquiggle = new RegExp(", "reader of a pretty baseline; the writers put spaces (tsgo) or the spaces of JavaScript (tsc) there"],
  ["plain.ts", "/^(\\S.*?)\\((\\d+),(\\d+)\\): (error|warning|suggestion|message) (?:TS", "reader of the lines that a linter prints, a JavaScript string"],
  ["checks.ts", "const head = /^(\\S.*?)\\(", "reader of the first section of a baseline, a JavaScript string"],
  ["checks.ts", "/^[a-z]:\\//i.test(m[1])", "a drive letter, ASCII"],
  ["checks.ts", "/^\\/[a-z]:\\//i.test(p.slice(root.length))", "a drive letter, ASCII"],
  ["check.ts", "/^[a-z][a-z0-9+.-]*:\\/\\//i.test(p.path)", "a scheme of a URL, ASCII"],
  ["shape.ts", "/(^|\\/)[tj]sconfig\\.json$/i.test(name)", "a config name on text of the model; without the flag u no rune outside ASCII folds to a letter"],
  ["materialize.ts", "const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?$/i;", "names that Windows reserves, ASCII"],
];
const suspect = /\\s|\\S|\\w|\\W|\\b|\\B|\/[dgsuvy]*[im][dgimsuvy]*[;,.) ]/;
let unknown = 0;
const used = new Set<number>();
for (const file of readdirSync(runner).filter(f => f.endsWith(".ts")).sort()) {
  if (file === "gostrings.ts") continue;
  readFileSync(join(runner, file), "utf8").split("\n").forEach((line, k) => {
    if (line.trimStart().startsWith("//") || !suspect.test(line)) return;
    const at = known.findIndex(([f, part]) => f === file && line.includes(part));
    if (at >= 0) {
      used.add(at);
      return;
    }
    console.log(`FAIL ${file}:${k + 1}: a class or a flag that Go reads in another way, at a place that is not known: ${line.trim().slice(0, 170)}`);
    unknown++;
  });
}
const stale = known.filter((_, k) => !used.has(k));
for (const [file, part] of stale) console.log(`FAIL ${file}: the known place is gone: ${part}`);
console.log(`${sites.length} ported regexps, ${bad} differ; ${known.length} known places with a class or flag of JavaScript, ${unknown} not known, ${stale.length} gone`);
process.exit(bad + unknown + stale.length === 0 ? 0 : 1);

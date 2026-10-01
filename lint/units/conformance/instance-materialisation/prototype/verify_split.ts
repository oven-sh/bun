// Research probe: roots and other files of every run instance against the baselines that the reference wrote.
import { existsSync, readFileSync } from "node:fs";
import { newCompilerTest, type CompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { readFile } from "./readfile";
import { getBaseFileName } from "./tspath";
import { changeExtension, fileExtensionIsOneOf } from "./tspath_more";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const which = process.argv[2] ?? "tsgo";
const baselineRoot =
  which === "tsgo"
    ? "/workspace/ref/typescript-go/testdata/baselines/reference/submodule"
    : "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const dirOf = (suite: string) => (which === "tsgo" ? baselineRoot + "/" + suite : baselineRoot);

// tsbaseline/util.go:24; no old string is a prefix of another, so the first match at a position is the only one
const olds: [string, string][] = [
  ["/.ts/", ""],
  ["/.lib/", ""],
  ["/.src/", ""],
  ["bundled:///libs/", ""],
  ["file:///./ts/", "file:///"],
  ["file:///./lib/", "file:///"],
  ["file:///./src/", "file:///"],
];
export function removeTestPathPrefixes(text: string): string {
  let out = "";
  let i = 0;
  outer: while (i < text.length) {
    for (const [o, n] of olds) {
      if (text.startsWith(o, i)) {
        out += n;
        i += o.length;
        continue outer;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

const e = enumerateInstances({ casesRoot });
const c: Record<string, number> = {};
const bump = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
const problems: string[] = [];
const rules: Record<string, number> = {};
const dump: string[] = [];
const cache = new Map<string, string>();
const decoder = new TextDecoder("utf-8");
const read = (p: string) => decoder.decode(readFileSync(p));

for (const inst of e.instances) {
  if (inst.status !== "run") {
    bump("not run");
    continue;
  }
  bump("run instances");
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) {
    content = readFile(file).contents;
    cache.set(file, content);
  }
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  if (!r.ok) {
    bump("status " + r.status);
    problems.push(`${inst.suite}/${inst.name}\t${r.status}\t${r.reason}`);
    continue;
  }
  const t: CompilerTest = r.value;
  rules[t.rule] = (rules[t.rule] ?? 0) + 1;
  const units = t.toBeCompiled.length + t.otherFiles.length;
  if (units > 1) bump("instances with more than one unit");
  if (t.rule === "config") bump("instances with a config unit");
  dump.push([inst.suite, inst.name, t.rule, t.currentDirectory, t.tsConfigFiles.map(f => f.unitName).join("|"), t.toBeCompiled.map(f => f.unitName).join("|"), t.otherFiles.map(f => f.unitName).join("|")].join("\t"));

  const dir = dirOf(inst.suite);
  // error baseline: config, roots, other files
  const errPath = dir + "/" + inst.name.replace(/\.tsx?$/, ".errors.txt");
  let evidence = 0;
  if (existsSync(errPath)) {
    bump("error baselines");
    const text = read(errPath);
    const got: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^==== (.*) \((\d+) errors\) ====$/.exec(line);
      if (m) got.push(m[1]);
    }
    const want = [...t.tsConfigFiles, ...t.toBeCompiled, ...t.otherFiles].map(f => removeTestPathPrefixes(f.unitName));
    // a pretty baseline has no file sections
    if (got.length === 0 && /\u001b\[/.test(text)) bump("error baselines in the pretty format");
    else if (JSON.stringify(got) === JSON.stringify(want)) {
      bump("error baselines that agree");
      evidence++;
    } else {
      bump("error baselines that differ");
      problems.push(`${inst.suite}/${inst.name}\terrors.txt\twant ${want.join(",")}\tgot ${got.join(",")}`);
    }
  }
  // js baseline: other files, then roots, with the bytes of each unit
  let jsName = inst.name;
  if (fileExtensionIsOneOf(jsName, [".ts", ".tsx"])) jsName = changeExtension(jsName, ".js");
  const jsPath = dir + "/" + jsName;
  if (t.hasNonDtsFiles && existsSync(jsPath)) {
    bump("js baselines");
    const text = read(jsPath);
    const sources = [...t.otherFiles, ...t.toBeCompiled];
    let ts = `//// [tests/cases/${inst.suite}/${inst.casePath.slice(inst.suite.length + 1)}] ////\r\n\r\n`;
    sources.forEach((f, i) => {
      ts += "//// [" + getBaseFileName(f.unitName) + "]\r\n" + f.content;
      if (i < sources.length - 1) ts += "\r\n";
    });
    if (text.startsWith(ts + "\r\n\r\n") || text === ts) {
      bump("js baselines that agree in order and bytes");
      evidence++;
    } else {
      // order alone
      const names = sources.map(f => getBaseFileName(f.unitName));
      const got: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        const m = /^\/\/\/\/ \[(.*)\]$/.exec(line);
        if (m) got.push(m[1]);
      }
      if (JSON.stringify(got.slice(0, names.length)) === JSON.stringify(names)) {
        bump("js baselines that agree in order only");
        problems.push(`${inst.suite}/${inst.name}\tjs bytes differ`);
      } else {
        bump("js baselines that differ");
        problems.push(`${inst.suite}/${inst.name}\tjs\twant ${names.join(",")}\tgot ${got.slice(0, names.length + 2).join(",")}`);
      }
    }
  }
  // types baseline: roots then other files, those that are in the program
  const typesPath = dir + "/" + inst.name.replace(/\.tsx?$/, ".types");
  if (existsSync(typesPath)) {
    bump("types baselines");
    const text = read(typesPath);
    const got: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^=== (.*) ===$/.exec(line);
      if (m && m[1] !== "Performance Stats") got.push(m[1]);
    }
    const want = [...t.toBeCompiled, ...t.otherFiles].map(f => removeTestPathPrefixes(f.unitName));
    let i = 0;
    let ok = true;
    for (const g of got) {
      while (i < want.length && want[i] !== g) i++;
      if (i === want.length) {
        ok = false;
        break;
      }
      i++;
    }
    // every root that can be a program file is in the program
    const roots = t.toBeCompiled.map(f => removeTestPathPrefixes(f.unitName)).filter(n => /\.[cm]?tsx?$/.test(n));
    const rootsIn = roots.every(n => got.includes(n));
    if (ok && rootsIn) {
      bump("types baselines that agree");
      evidence++;
    } else {
      bump("types baselines that differ");
      problems.push(`${inst.suite}/${inst.name}\ttypes\t${ok ? "" : "order "}${rootsIn ? "" : "root missing "}\twant ${want.join(",")}\tgot ${got.join(",")}`);
    }
  }
  if (evidence === 0) bump("instances with no baseline that shows the order");
  if (units > 1 && evidence === 0) {
    bump("instances with more than one unit and no evidence");
    problems.push(`${inst.suite}/${inst.name}\tno evidence\t${t.rule}\troots ${t.toBeCompiled.map(f => f.unitName).join(",")}\tothers ${t.otherFiles.map(f => f.unitName).join(",")}`);
  }
  if (units > 1) bump("evidence count " + evidence + " (more than one unit)");
  if (t.rule === "config") bump("config instances with evidence count " + evidence);
}
console.log(JSON.stringify(c, null, 1));
console.log(JSON.stringify(rules));
const out = process.argv[3];
if (out) {
  await Bun.write(out + ".problems.txt", problems.join("\n") + "\n");
  await Bun.write(out + ".split.tsv", dump.join("\n") + "\n");
}
console.log("problems:", problems.length);
for (const p of problems.slice(0, 60)) console.log(p.slice(0, 400));

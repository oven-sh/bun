// Whatever lies in this folder is run by CI, is used by something that CI runs, or is a tool that a README explains.
//
// CI runs every file whose name says that it is a test (scripts/runner.node.ts) and every file of the folders in `walked`.
// A file uses another by importing it or by spelling its path: in a literal, or in a call of join() or resolve() that begins
// at import.meta.dir. A path that ends in something computed stands for the whole folder it has named so far. Where it is
// imported or its extension is written, it stands for the files of that folder whose names the file spells, if it spells any.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

const here = import.meta.dir;
const repository = resolve(here, "..", "..");

// run-parallel.ts, `cargo test -p bun_aot --test ir_tests` and engine/testaot.ts take every file of the first three.
// The programs of parallel/ import what lies in the fourth. scripts/rust-test.ts hands run-parallel.ts every file of the fifth.
const walked = ["parallel", "ir", "engine-tests", "fixtures", "library-sweeps"];

// Where code outside test/ spells a path of this folder.
const outside = ["src/aot", "src/sema", "src/codegen/builtins", "scripts", ".github/workflows", ".buildkite"];

// What somebody starts by hand, and the page that says how. A new line here needs a command line there.
const tools: Record<string, string> = {
  "backend/card.py": "backend/README.md",
  "backend/tracker/pieces": "backend/tracker/README.md",
  "fuzz/burst.ts": "fuzz/README.md",
  "fuzz/fuzzilli": "fuzz/fuzzilli/README.md",
  "fuzz/run.ts": "fuzz/README.md",
  "fuzz/texts-for-generated-types.ts": "fuzz/README.md",
  "other-suites": "README.md",
  "perf/measure.ts": "perf/README.md",
  "sanitizers/thread-sanitizer.ts": "README.md",
  "servers/go": "servers/measure/README.md",
  "servers/rust": "servers/measure/README.md",
  "servers/tanstack": "servers/measure/README.md",
  "shell/bad-time.py": "README.md",
  "shell/collector-stress.py": "README.md",
  "shell/test262.py": "README.md",
  "shell/where-it-died.py": "README.md",
  "tools/exact_counts.py": "perf/README.md",
  "tools/ir-test-from-source.ts": "README.md",
  "tools/name_sample.py": "README.md",
  "tools/update-ir-tests.ts": "README.md",
  "trimmed-against-whole/run.ts": "README.md",
  "trimmed-is-whole/sweep.ts": "README.md",
  "typed-packages/measure/measure.ts": "typed-packages/measure/README.md",
  "whole-suite.ts": "README.md",
};

// What nothing reaches today: a file, or a folder with all it holds. Nothing may be added, and a line goes with its files.
// prettier-ignore
const unreachedToday: string[] = [
  "startup-scaling",
];

const isSkipped = (name: string) => name === "node_modules" || name === "__pycache__" || name === ".DS_Store";
function* filesBelow(folder: string): Generator<string> {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (isSkipped(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* filesBelow(path);
    else yield path;
  }
}

const isScript = (path: string) => /\.[cm]?[jt]sx?$/.test(path);
const isTestFile = (path: string) => isScript(path) && /\.test|spec\./.test(basename(path));
const nameOf = (path: string) => relative(here, path).replaceAll(sep, "/");

const files = new Set(filesBelow(here));
const filesOfFolder = new Map<string, string[]>();
for (const path of files)
  for (let folder = dirname(path); folder.length > here.length; folder = dirname(folder))
    (filesOfFolder.get(folder) ?? filesOfFolder.set(folder, []).get(folder)!).push(path);

const reached = new Set<string>();
const toRead: string[] = [];
function reach(path: string) {
  if (reached.has(path)) return;
  reached.add(path);
  toRead.push(path);
}

const endings = ["", ".ts", ".mts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".py", "/index.ts", "/index.js"];
function reachModule(path: string) {
  const ending = endings.find(ending => files.has(path + ending));
  if (ending !== undefined) reach(path + ending);
  return ending !== undefined;
}

/** A folder that the file itself lies in is where it counts from, not something it reads. */
function reachPath(spelled: string, from: string, mayBeFolder = true) {
  const path = resolve(spelled);
  if (files.has(path)) reach(path);
  else if (mayBeFolder && filesOfFolder.has(path) && !from.startsWith(path + sep))
    filesOfFolder.get(path)!.forEach(reach);
  else return false;
  return true;
}

/** Where `isWhole` is false the path is a folder, and the name of the file in it begins with `prefix` and ends with `suffix`. */
type Value = { path: string; isWhole: boolean; end: number; prefix?: string; suffix?: string };

/** The path that the expression at `at` stands for, as far as it is written down. */
function evaluate(text: string, at: number, file: string, constants: Map<string, string>): Value | undefined {
  while (/\s/.test(text[at])) at++;
  const rest = text.slice(at, at + 400);
  const whole = (path: string, length: number): Value => ({ path, isWhole: true, end: at + length });
  let match: RegExpMatchArray | null;
  if ((match = rest.match(/^(?:path\.)?(?:join|resolve)\(/))) {
    let path: string | undefined;
    for (let position = at + match[0].length; ;) {
      while (/[\s,]/.test(text[position])) position++;
      if (text[position] === ")") return path === undefined ? undefined : { path, isWhole: true, end: position + 1 };
      const part = evaluate(text, position, file, constants);
      if (!part) {
        const [, suffix = ""] =
          text.slice(position, position + 200).match(/^[\w$.]+\s*\+\s*["'](\.[\w.]+)["']\s*[,)]/) ?? [];
        return path === undefined ? undefined : { path, suffix, isWhole: false, end: position };
      }
      path = path === undefined ? part.path : resolve(path, part.path);
      if (!part.isWhole) return { ...part, path };
      position = part.end;
    }
  }
  if ((match = rest.match(/^(?:fileURLToPath\(\s*)?new URL\(\s*["'`]([^"'`$]+)["'`]\s*,\s*import\.meta\.url\s*\)\)?/)))
    return whole(resolve(dirname(file), match[1]), match[0].length);
  if ((match = rest.match(/^(?:(?:path\.)?dirname|String)\(/))) {
    const inner = evaluate(text, at + match[0].length, file, constants);
    if (!inner?.isWhole) return undefined;
    return {
      ...inner,
      path: match[0].includes("dirname") ? dirname(inner.path) : inner.path,
      end: text.indexOf(")", inner.end) + 1,
    };
  }
  let value: Value | undefined;
  if ((match = rest.match(/^(?:import\.meta\.(?:dirname|dir)\b|__dirname\b)/)))
    value = whole(dirname(file), match[0].length);
  else if ((match = rest.match(/^(?:import\.meta\.(?:filename|path)\b|__filename\b)/)))
    value = whole(file, match[0].length);
  else if ((match = rest.match(/^"((?:[^"\\\n]|\\.)*)"|^'((?:[^'\\\n]|\\.)*)'/)))
    value = whole(match[1] ?? match[2], match[0].length);
  else if (rest[0] === "`") {
    const length = rest.slice(1).search(/(?<!\\)`/);
    if (length < 0) return undefined;
    const body = rest.slice(1, length + 1);
    let path = "";
    for (let position = 0; position < body.length;) {
      if (!body.startsWith("${", position)) path += body[position++];
      else {
        const close = body.indexOf("}", position);
        const inner = close < 0 ? undefined : evaluate(body.slice(position + 2, close) + " ", 0, file, constants);
        if (!inner?.isWhole) {
          const cut = path.lastIndexOf("/");
          if (cut < 0) return undefined;
          const rest = close < 0 ? "" : body.slice(close + 1);
          return {
            path: path.slice(0, cut) || "/",
            prefix: path.slice(cut + 1),
            suffix: /[$/]/.test(rest) ? "" : rest,
            isWhole: false,
            end: at + length + 2,
          };
        }
        path += inner.path;
        position = close + 1;
      }
    }
    value = whole(path, length + 2);
  } else if ((match = rest.match(/^[A-Za-z_$][\w$]*(?![\w$]*\s*[.(\[])/)) && constants.has(match[0]))
    value = whole(constants.get(match[0])!, match[0].length);
  if (!value) return undefined;
  const more = text.slice(value.end, value.end + 8).match(/^\s*\+\s*(?=["'`])/);
  if (!more || !isAbsolute(value.path)) return value;
  const next = evaluate(text, value.end + more[0].length, file, constants);
  return next ? { ...next, path: value.path + next.path } : { ...value, isWhole: false };
}

const constantsOfFile = new Map<string, Map<string, string>>();
/** The names of a file that stand for a path, its own and those it imports. */
function constantsOf(file: string): Map<string, string> {
  let constants = constantsOfFile.get(file);
  if (constants) return constants;
  constantsOfFile.set(file, (constants = new Map()));
  const text = readFileSync(file, "utf8");
  for (const [, names, specifier] of text.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = endings
      .map(ending => resolve(dirname(file), specifier) + ending)
      .find(path => isScript(path) && existsSync(path));
    if (!target) continue;
    for (const name of names.split(",")) {
      const [theirs, ours = theirs] = name.trim().split(/\s+as\s+/);
      const value = constantsOf(target).get(theirs);
      if (value !== undefined) constants.set(ours, value);
    }
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*/g)) {
    const value = evaluate(text, match.index + match[0].length, file, constants);
    if (value?.isWhole && isAbsolute(value.path) && /^\s*[;\n,]/.test(text.slice(value.end, value.end + 3) + "\n"))
      constants.set(match[1], value.path);
  }
  return constants;
}

const literal = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$\n]|\\.)*)`/g;
const literalsOf = (text: string) =>
  [...text.matchAll(literal)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? "")
    .filter(word => /^[\w@.\-/ +,()[\]]{2,250}$/.test(word));

function read(file: string) {
  const folder = dirname(file);
  const text = readFileSync(file, "utf8");
  if (isScript(file)) {
    for (const [, specifier] of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire(?:\.resolve)?\s*\(\s*)["'`](\.[^"'`\n?]+)/g,
    ))
      reachModule(resolve(folder, specifier));
    const constants = constantsOf(file);
    const words = literalsOf(text);
    for (const match of text.matchAll(
      /\b(?:join|resolve)\(|`\$\{|\b(?:import|require)\(\s*(?=`)|new URL\(|\bimport\.meta\.dir(?:name)?\s*\+/g,
    )) {
      const isImport = /^(?:import|require)\(/.test(match[0]);
      const value = evaluate(text, match.index + (isImport ? match[0].length : 0), file, constants);
      if (!value || (!isImport && !isAbsolute(value.path))) continue;
      const path = resolve(folder, value.path);
      if (path === here) continue;
      if (value.isWhole) isImport ? reachModule(path) : reachPath(path, file);
      else {
        // A computed name begins and ends as written. The name of a file is one that the file spells, if it spells any.
        const { prefix = "", suffix = "" } = value;
        const inside = filesOfFolder.get(path) ?? [];
        const nameIn = (below: string) => relative(path, below).split(sep)[0];
        const named = inside.filter(below => nameIn(below).startsWith(prefix) && nameIn(below).endsWith(suffix));
        const spelled = named.filter(below => words.includes(nameIn(below).replace(/\.\w+$/, "")));
        const isOneOfFew = !prefix && (isImport || suffix !== "") && spelled.length > 0;
        (isOneOfFew ? spelled : named).forEach(reach);
      }
    }
    for (const word of words)
      if (word.startsWith("test/aot/")) reachPath(resolve(repository, word), file);
      else if (/^\.\.?\//.test(word)) reachModule(resolve(folder, word)) || reachPath(resolve(folder, word), file);
      else if (/\.\w+$/.test(word)) reachPath(resolve(folder, word), file, false);
  } else if (/\.(py|sh)$/.test(file)) {
    for (const [, from, names] of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/gm))
      for (const name of (from ?? names).split(",")) reachModule(join(folder, name.trim().replaceAll(".", "/")));
    for (const line of text.split("\n")) {
      const words = literalsOf(line).map(word => word.replace(/^\//, ""));
      for (let first = 0; first < words.length; first++)
        for (let last = words.length; last > first; last--)
          if (reachPath(resolve(folder, words.slice(first, last).join("/")), file)) break;
    }
  }
}

function readAll() {
  while (toRead.length) {
    const file = toRead.pop()!;
    // The lists above spell paths and use nothing.
    if (file !== import.meta.path && !walked.some(folder => file.startsWith(join(here, folder) + sep))) read(file);
    // A build or a run of a file reads these by itself.
    for (let folder = dirname(file); folder.length > here.length; folder = dirname(folder))
      for (const name of ["tsconfig.json", "package.json", "bunfig.toml"])
        if (files.has(join(folder, name))) reach(join(folder, name));
  }
}

test("every file is run, is used by what is run, or is a tool with its page", () => {
  for (const path of files)
    if (
      isTestFile(path) ||
      basename(path) === "README.md" ||
      walked.some(folder => path.startsWith(join(here, folder) + sep))
    )
      reach(path);
  reach(join(here, "run-parallel.ts"));
  for (const path of filesBelow(dirname(here)))
    if (!path.startsWith(here + sep) && isTestFile(path) && readFileSync(path, "utf8").includes("aot/")) read(path);
  for (const place of outside)
    for (const path of filesBelow(join(repository, place)))
      if (!path.endsWith(".md"))
        for (const [, name] of readFileSync(path, "utf8").matchAll(/test\/aot\/([\w@.\-/]*[\w@\-])/g))
          reachPath(join(here, name), path);
  readAll();

  const withoutPage = Object.entries(tools).filter(
    ([tool, page]) =>
      !(files.has(join(here, tool)) || filesOfFolder.has(join(here, tool))) ||
      ![tool, posix.relative(posix.dirname(page), tool)].some(name =>
        readFileSync(join(here, page), "utf8").includes(name),
      ),
  );
  for (const tool of Object.keys(tools)) reachPath(join(here, tool), here);
  readAll();

  const isListed = (name: string) => unreachedToday.some(line => name === line || name.startsWith(line + "/"));
  const unreached = [...files].filter(path => !reached.has(path)).map(nameOf);
  expect({
    "reached by nothing": unreached.filter(name => !isListed(name)).sort(),
    "tools that are not there, or that their page does not name": withoutPage,
    "lines of unreachedToday that hold nothing unreached": unreachedToday.filter(
      line => !unreached.some(name => name === line || name.startsWith(line + "/")),
    ),
  }).toEqual({
    "reached by nothing": [],
    "tools that are not there, or that their page does not name": [],
    "lines of unreachedToday that hold nothing unreached": [],
  });
});

test("a platform of CI that names its tests names files, and the file that never skips itself", () => {
  const rows = Array.from(
    readFileSync(join(repository, ".buildkite", "ci.ts"), "utf8").matchAll(/^ +tests: \[([^\]]*)\]/gm),
    ([, row]) => Array.from(row.matchAll(/"([^"]+)"/g), ([, part]) => part),
  );
  const names = [...files].filter(isTestFile).map(path => "aot/" + nameOf(path));
  expect({
    "parts of a path that no test file has": rows.flat().filter(part => !names.some(name => name.includes(part))),
    "rows without it": rows.filter(row => !row.includes("aot/the-build-under-test")),
  }).toEqual({ "parts of a path that no test file has": [], "rows without it": [] });
});

// Makes a program small while it keeps failing in the same way: delta debugging on lines, on blocks (a block goes, or only its head
// and its closing brace go), on bracketed groups and on tokens.
//
// Candidates are tested many at a time, because one build of the product can hold many programs: `fails` answers for a list. Those
// of a list that still fail are then applied together if that fails too, else as many of them as do.
//
// A program of several files loses files first (reduceFiles): a file goes with the statements that name it, or its text goes into a file that imports it. Then each file that is left is made small as above,
// and files are tried again, because a file that nobody imports any more can go.
//
//   bun test/aot/fuzz/reduce.ts <folder of a program> <folder for the result> [--entry main.ts] [--jobs 8] [--seconds 1500] -- <command> [words]
//
// The command is run as `<command> [words] <the candidate's first file>` in the candidate's folder, and exits with 0 if the candidate still shows what the program showed.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { withoutInstallingPackages } from "../harness/without-installing-packages";
import { dirname, join, relative } from "path";
import { tokenize } from "./tokens";

export interface Reduction {
  text: string;
  /** Candidates tested, and calls of `fails`. */
  tests: number;
  rounds: number;
}

export interface ReduceOptions {
  parses(candidate: string): boolean;
  fails(candidates: string[]): Promise<boolean[]>;
  /** How many candidates one call of `fails` takes. */
  width: number;
  seconds: number;
}

// The text is cut into pieces; an edit blanks some and may rewrite one.
interface Edit {
  blank: number[];
  put?: { at: number; text: string };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

function applied(pieces: string[], edits: Edit[]): string[] {
  const next = [...pieces];
  for (const edit of edits) {
    for (const index of edit.blank) next[index] = "";
    if (edit.put) next[edit.put.at] = edit.put.text;
  }
  return next;
}

const lines = (text: string) => text.split(/(?<=\n)/);

function tokenPieces(text: string): string[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [text];
  return [text.slice(0, tokens[0].start), ...tokens.map((token, index) => text.slice(token.start, tokens[index + 1]?.start ?? text.length))];
}

function chunks(count: number, size: number): Edit[] {
  const edits: Edit[] = [];
  for (let end = count; end > 0; end -= size) edits.push({ blank: range(Math.max(0, end - size), end) });
  return edits;
}

function blocks(pieces: string[]): Edit[] {
  const edits: Edit[] = [];
  pieces.forEach((line, at) => {
    if (!/[{(\[]\s*$/.test(line)) return;
    let depth = 0;
    for (let end = at; end < pieces.length; end++) {
      for (const token of tokenize(pieces[end])) {
        if (token.kind !== "punctuator") continue;
        if ("{([".includes(token.text)) depth++;
        else if ("})]".includes(token.text)) depth--;
      }
      if (depth > 0) continue;
      if (end > at) edits.push({ blank: range(at, end + 1) }, { blank: [at, end] });
      return;
    }
  });
  return edits;
}

// `f(() => x)` becomes `f()`, `x` or `0`.
function groups(pieces: string[]): Edit[] {
  const edits: Edit[] = [];
  const open: number[] = [];
  pieces.forEach((piece, at) => {
    const text = piece.trim();
    if (text === "(" || text === "[" || text === "{") open.push(at);
    else if (text === ")" || text === "]" || text === "}") {
      const from = open.pop();
      if (from === undefined) return;
      if (at > from + 1) edits.push({ blank: range(from + 1, at) }, { blank: range(from + 1, at + 1), put: { at: from, text: "0 " } });
      edits.push({ blank: [from, at] });
    }
  });
  return edits.sort((a, b) => b.blank.length - a.blank.length);
}

export async function reduce(text: string, { parses, fails, width, seconds }: ReduceOptions): Promise<Reduction> {
  const deadline = Date.now() + seconds * 1000;
  const tried = new Set<string>();
  let tests = 0;
  let rounds = 0;

  const test = async (candidates: string[]) => {
    tests += candidates.length;
    rounds++;
    return fails(candidates);
  };

  // Tries the edits on the pieces and returns the pieces with all that could be applied.
  const attempt = async (pieces: string[], edits: Edit[]): Promise<string[]> => {
    for (let at = 0; at < edits.length && Date.now() < deadline; ) {
      const group: { edit: Edit; text: string }[] = [];
      const size = pieces.join("").length;
      for (; at < edits.length && group.length < width; at++) {
        const edit = edits[at];
        if (!edit.blank.some(index => pieces[index] !== "")) continue;
        const candidate = applied(pieces, [edit]).join("");
        if (candidate.length >= size || tried.has(candidate) || !parses(candidate)) continue;
        tried.add(candidate);
        group.push({ edit, text: candidate });
      }
      if (!group.length) continue;
      const results = await test(group.map(each => each.text));
      const good = group.filter((_, index) => results[index]).map(each => each.edit);
      if (!good.length) continue;
      if (good.length === 1) {
        pieces = applied(pieces, good);
        continue;
      }
      // All of them at once, or the longest run of them from the first on: one more call answers for every length.
      const prefixes = good.map((_, index) => applied(pieces, good.slice(0, good.length - index)));
      const usable = prefixes.map(each => each.join("")).map(candidate => parses(candidate));
      const wanted = prefixes.filter((_, index) => usable[index]).slice(0, width);
      const answers = await test(wanted.map(each => each.join("")));
      pieces = wanted[answers.indexOf(true)] ?? applied(pieces, [good[0]]);
    }
    return pieces;
  };

  const pass = async (cut: (text: string) => string[], edits: (pieces: string[]) => Edit[]) => {
    const before = text.length;
    text = (await attempt(cut(text), edits(cut(text)))).join("");
    return text.length < before;
  };

  const bySize = async (cut: (text: string) => string[], largest: number) => {
    for (let size = Math.min(largest, Math.max(1, cut(text).length >> 1)); size >= 1 && Date.now() < deadline; ) {
      const progress = await pass(cut, pieces => chunks(pieces.length, size));
      if (!(progress && size === 1)) size = size === 1 ? 0 : size >> 1;
    }
  };

  for (let round = 0; round < 8 && Date.now() < deadline; round++) {
    const before = text.length;
    await bySize(lines, Infinity);
    text = text.replace(/\n\s*\n/g, "\n");
    await pass(lines, blocks);
    if (text.length < 6000) {
      await pass(tokenPieces, groups);
      await bySize(tokenPieces, 8);
    }
    if (text.length === before) break;
  }
  return { text: text.replace(/\n\s*\n/g, "\n").trim() + "\n", tests, rounds };
}

/** What runs first, and the other files by their paths from its folder. */
export interface Whole {
  text: string;
  files?: Record<string, string>;
}

export interface ReduceFilesOptions {
  /** `path` is that of a file of `files`; none for the text that runs first. */
  parses(candidate: string, path?: string): boolean;
  fails(candidates: Whole[]): Promise<boolean[]>;
  width: number;
  seconds: number;
  /** The path of the text that runs first, as the other files name it. */
  entry: string;
}

const quoted = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The import and export statements of a file at `from` that name the file at `to`, with or without its extension; a file of a package in node_modules is named by the package. */
function statementsNaming(from: string, to: string): RegExp {
  const path = relative(dirname(from), to).replaceAll("\\", "/");
  const ofPackage = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(to)?.[1];
  const specifier = ofPackage ? quoted(ofPackage) : quoted(path.startsWith(".") ? path : "./" + path).replace(/\\\.\w+$/, "(?:$&|\\.[cm]?js)?");
  return new RegExp(`^[ \\t]*(?:import|export)\\b[\\w$*\\s,]*(?:\\{[^{}]*\\})?[\\w$*\\s,]*(["'])${specifier}\\1[^;\\n]*;?[ \\t]*\\n?`, "gm");
}

// `import { a, b } from ".."` twice in one file: each name stays where it stands first.
function withoutRepeatedImports(text: string): string {
  const seen = new Set<string>();
  return text.replace(/^([ \t]*import (?:type )?\{)([^}]*)(\} from [^;\n]*;?[ \t]*\n?)/gm, (_, head: string, names: string, tail: string) => {
    const kept = names.split(",").map(name => name.trim()).filter(name => name && !seen.has(name.split(/\s+as\s+/).pop()!)); // prettier-ignore
    for (const name of kept) seen.add(name.split(/\s+as\s+/).pop()!);
    return kept.length ? `${head} ${kept.join(", ")} ${tail}` : "";
  });
}

export async function reduceFiles(whole: Whole, { parses, fails, width, seconds, entry }: ReduceFilesOptions): Promise<Reduction & Whole> {
  const deadline = Date.now() + seconds * 1000;
  let tests = 0;
  let rounds = 0;
  // By path; the text that runs first is the first.
  let files = new Map([[entry, whole.text], ...Object.entries(whole.files ?? {})]);
  const asWhole = (all: Map<string, string>): Whole => ({ text: all.get(entry)!, ...(all.size > 1 ? { files: Object.fromEntries([...all].filter(([path]) => path !== entry)) } : {}) });
  const isWellFormed = (all: Map<string, string>) => [...all].every(([path, text]) => text === files.get(path) || parses(text, path === entry ? undefined : path));

  const without = (gone: string) => new Map([...files].filter(([path]) => path !== gone).map(([path, text]) => [path, text.replace(statementsNaming(path, gone), "")]));
  const importers = (of: string) => [...files].filter(([path, text]) => path !== of && statementsNaming(path, of).test(text)).map(([path]) => path);
  // The text of `gone` stands where `into` first named it. Whoever else named `gone` names `into`.
  const folded = (gone: string, into: string) => {
    let isLaid = false;
    const laid = files.get(gone)!.replace(statementsNaming(gone, into), "");
    const joined = files.get(into)!.replace(statementsNaming(into, gone), () => (isLaid ? "" : ((isLaid = true), laid.endsWith("\n") ? laid : laid + "\n")));
    const name = (from: string) => "./" + relative(dirname(from), into).replaceAll("\\", "/").replace(/\.ts$/, "");
    return new Map(
      [...files]
        .filter(([path]) => path !== gone)
        .map(([path, text]) => [path, path === into ? withoutRepeatedImports(joined) : text.replace(statementsNaming(path, gone), statement => statement.replace(/(["'])[^"']*\1(?=[^"']*$)/, `"${name(path)}"`))]),
    );
  };

  // The first candidate that still fails is taken, and the rest is made anew from what is left.
  const takeWhileItFails = async (candidates: () => Map<string, string>[]) => {
    for (let hasChanged = true; hasChanged && Date.now() < deadline; ) {
      hasChanged = false;
      const wellFormed = candidates().filter(isWellFormed);
      for (let at = 0; at < wellFormed.length && !hasChanged && Date.now() < deadline; at += width) {
        const group = wellFormed.slice(at, at + width);
        tests += group.length;
        rounds++;
        const taken = group[(await fails(group.map(asWhole))).indexOf(true)];
        if (taken) [files, hasChanged] = [taken, true];
      }
    }
  };
  const others = () => [...files.keys()].filter(path => path !== entry);

  for (let round = 0; round < 4 && Date.now() < deadline; round++) {
    const before = [...files.values()].join("").length;
    await takeWhileItFails(() => others().map(without));
    await takeWhileItFails(() => others().flatMap(gone => importers(gone).filter(into => dirname(into) === dirname(gone)).map(into => folded(gone, into))));
    const paths = [...files.keys()];
    for (const [index, path] of paths.entries()) {
      const reduced = await reduce(files.get(path)!, {
        parses: candidate => parses(candidate, path === entry ? undefined : path),
        fails: candidates => fails(candidates.map(candidate => asWhole(new Map(files).set(path, candidate)))),
        width,
        seconds: Math.max(0, deadline - Date.now()) / 1000 / (paths.length - index),
      });
      tests += reduced.tests;
      rounds += reduced.rounds;
      // What reduce() does to blank lines at its end is not tested.
      if (reduced.tests) files.set(path, reduced.text);
    }
    if (files.size === 1 || [...files.values()].join("").length === before) break;
  }
  return { ...asWhole(files), tests, rounds };
}

/** The shape of a program: names numbered in order of appearance, literals by kind. Two programs of one shape are one finding. */
export function shape(text: string): string {
  const names = new Map<string, string>();
  return tokenize(text)
    .map(token => {
      if (token.kind === "number") return "0";
      if (token.kind === "string" || token.kind === "template") return '""';
      if (token.kind !== "name") return token.text;
      if (/^(await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|function|if|in|instanceof|let|new|return|static|super|switch|this|throw|try|typeof|var|void|while|yield|async|of|get|set|null|true|false|undefined|Object|Array|Reflect|Proxy|Symbol|Map|Set|JSON|Math|Promise|String|Number|Error|print|console|log)$/.test(token.text)) return token.text; // prettier-ignore
      if (!names.has(token.text)) names.set(token.text, "n" + names.size);
      return names.get(token.text)!;
    })
    .join(" ");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--");
  const [words, command] = [process.argv.slice(2, at), process.argv.slice(at + 1)];
  const option = (name: string, otherwise: string) => (words.includes(name) ? words.splice(words.indexOf(name), 2)[1] : otherwise);
  const [entry, jobs, seconds] = [option("--entry", ""), Number(option("--jobs", "8")), Number(option("--seconds", "1500"))];
  const [source, result] = words;
  const paths = (readdirSync(source, { recursive: true, withFileTypes: true }) as import("fs").Dirent[]).filter(each => each.isFile()).map(each => relative(source, join(each.parentPath, each.name)));
  const isCode = (path: string) => /\.[cm]?[jt]sx?$/.test(path) && !path.split("/").includes("node_modules");
  const first = entry || paths.find(path => /^main\.\w+$/.test(path))!;
  const work = mkdtempSync(join(withoutInstallingPackages(process.env.REDUCE_TMP ?? tmpdir()), "reduce-"));
  const write = (folder: string, { text, files }: Whole) => {
    // What is no code is there for every candidate.
    cpSync(source, folder, { recursive: true, filter: path => !isCode(relative(source, path)) });
    for (const [path, each] of Object.entries({ ...files, [first]: text })) (mkdirSync(dirname(join(folder, path)), { recursive: true }), writeFileSync(join(folder, path), each));
  };
  let made = 0;
  const fails = (candidates: Whole[]) =>
    Promise.all(
      candidates.map(async candidate => {
        const folder = join(work, String(made++));
        write(folder, candidate);
        const child = Bun.spawn({ cmd: [...command, join(folder, first)], cwd: folder, stdio: ["ignore", "ignore", "ignore"], timeout: 600_000, killSignal: "SIGKILL" });
        const code = await child.exited;
        rmSync(folder, { recursive: true, force: true });
        return code === 0;
      }),
    );
  const parsers = new Map<string, Bun.Transpiler>();
  const parses = (candidate: string, path = first) => {
    const loader = path.endsWith(".tsx") ? "tsx" : path.endsWith("ts") ? "ts" : "jsx";
    try {
      (parsers.get(loader) ?? parsers.set(loader, new Bun.Transpiler({ loader })).get(loader)!).transformSync(candidate);
      return true;
    } catch {
      return false;
    }
  };
  const whole: Whole = { text: readFileSync(join(source, first), "utf8"), files: Object.fromEntries(paths.filter(path => isCode(path) && path !== first).map(path => [path, readFileSync(join(source, path), "utf8")])) };
  if (!(await fails([whole]))[0]) throw new Error("the program as it is does not show it");
  const reduced = await reduceFiles(whole, { parses, fails, width: jobs, seconds, entry: first });
  rmSync(result, { recursive: true, force: true });
  write(result, reduced);
  rmSync(work, { recursive: true, force: true });
  console.log(`${Object.keys(reduced.files ?? {}).length + 1} files, ${[reduced.text, ...Object.values(reduced.files ?? {})].join("").split("\n").length - 1} lines, ${reduced.tests} tests`);
}

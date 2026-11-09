// Takes every small stored program under ../../parallel, and every program under ./textbook, and moves one thing in it: a table of single moves, times each place in the text where a move fits. Each program that comes of it is built alone and must
// answer as `bun <file>` does. A stored program is sound, and what stands one step beside it is what somebody writes tomorrow: a loop that counts down for one that counts up, `at + 1` for `at`, a CommonJS file for an
// ES file, a star beside a statement, a field in package.json, `import * as` for a name.
//
//   bun write-one-step-departures.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<move>--<place>--<family>--<program>.<kind>
//   bun write-one-step-departures.ts count
//   bun write-one-step-departures.ts named <pattern> <folder> [most]
//   bun write-one-step-departures.ts moves          a line for each move: where its programs begin in the row, and how many they are
//   bun write-one-step-departures.ts where <n>      the stored program, the move and the place of one program of the row
//
// The stored programs are witnesses of old faults: few of their loops count down, keep a value from turn to turn or fill a second list. ./textbook holds what a textbook holds: sums in front, the greatest so far, sorting,
// tables filled row by row. STORED_PROGRAMS=<folder> takes the programs from another folder. There, as under ../../parallel, a folder with a main file is one program and every other file is a program by itself; a file may hold several, each
// behind a line `// @filename: ./x`, as the other writers here lay them. The moves on the graph of modules come first in the row, then the moves on loops.
// Several folders are parted by a colon. MOVES=<pattern> keeps the moves of such names alone, and SEEDS_WITH=<pattern> the programs in which a move of such a name fits. What this writes is itself such a folder: a second
// step is this writer over what it wrote.
//
// No move may make a program that does not end: a loop is turned round only where its turn leaves the counter alone, and a store goes further only where the bound of the loop is read once or is no length.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, posix } from "path";

type Files = Map<string, string>;
type Program = { path: string; entry: string; files: Files };
type Departed = { entry?: string; files: Files };
type Move = { name: string; places(program: Program): (() => Departed | undefined)[] };

const stored = (
  process.env.STORED_PROGRAMS ?? join(import.meta.dir, "..", "..", "parallel") + ":" + join(import.meta.dir, "textbook")
).split(":");

// ---- the stored programs

const isCode = (path: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
const isText = (path: string) =>
  isCode(path) || /\.(?:json|txt|toml|css|html|md)$/.test(path) || /\.d\.[cm]?ts$/.test(path);
// How it is built and run goes by a line in its head, or it asks the clock, the machine, the collector or another process.
const isLeftOut =
  /^\/\/ (?:Sizes|Passes|Grows|Env[^:\n]*|Flags|Reference|It writes a program|Build prints[^:\n]*|Entry points|Todo[^:\n]*|Runs by itself|Prints what[^:\n]*|No build under[^:\n]*|It sends bytes|The output is stored):|\b(?:Worker|Bun\.serve|Bun\.spawn\w*|child_process|cluster|setInterval|performance|Date\.now|new Date\(\)|Math\.random|hrtime|WeakRef|FinalizationRegistry|Bun\.gc|memoryUsage|node:http\w*|node:net|node:vm|fetch|execPath|stdin|mainModule|bun:test|bun:jsc)\b|\brequire\s*\.\s*main\b|\bmeta\s*\.\s*main\b|\bmodule\s*\.\s*parent\b|^#!|\r/m;
const [mostBytes, mostFiles] = [24_000, 24];

function filesBelow(folder: string, prefix = ""): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap(entry =>
      entry.isDirectory() ? filesBelow(join(folder, entry.name), prefix + entry.name + "/") : [prefix + entry.name],
    );
}

function kept(path: string, entry: string, files: Files): Program[] {
  let bytes = 0;
  for (const [name, text] of files) {
    bytes += text.length;
    if (/\s/.test(name) || isLeftOut.test(text)) return [];
  }
  if (bytes > mostBytes || files.size > mostFiles) return [];
  const program = { path, entry, files };
  // It names a file that is not its own.
  for (const [name, text] of files)
    if (isCode(name))
      for (const [, specifier] of text.matchAll(
        /(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*["'](\.\.?\/[^"'\n]+)["']/g,
      ))
        if (!found(program, name, specifier)) return [];
  return [program];
}

function* programsBelow(folder: string, path: string): Generator<Program> {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const main = entries.find(entry => entry.isFile() && /^main\.[^.]+$/.test(entry.name) && isCode(entry.name));
  if (main) {
    const names = filesBelow(folder);
    if (names.length <= mostFiles && names.every(isText))
      yield* kept(path, main.name, new Map(names.map(name => [name, readFileSync(join(folder, name), "utf8")])));
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const below = path ? path + "/" + entry.name : entry.name;
    if (entry.isDirectory()) yield* programsBelow(join(folder, entry.name), below);
    else if (isCode(entry.name)) {
      const lines = readFileSync(join(folder, entry.name), "utf8").split("\n");
      const named = /^\/\/ @entry: \.\/(\S+)$/.exec(lines[0]);
      if (named) lines.shift();
      const first = named?.[1] ?? "main" + /\.[^.]+$/.exec(entry.name)![0];
      const parts = new Map<string, string[]>([[first, []]]);
      let into = parts.get(first)!;
      for (const line of lines) {
        const next = /^\/\/ @filename: \.\/(\S+)/.exec(line);
        if (next) parts.set(next[1], (into = []));
        else into.push(line);
      }
      yield* kept(below, first, new Map([...parts].map(([name, text]) => [name, text.join("\n")])));
    }
  }
}

// ---- what the moves share

const hasStatements = (text: string) => /^(?:import\b(?!\s*\()|export\b)/m.test(text);
const isES = (path: string, text: string) =>
  /\.m[jt]s$/.test(path) || (/\.(?:[jt]s|[jt]sx)$/.test(path) && hasStatements(text));
const isCommonJS = (path: string, text: string) =>
  /\.c[jt]s$/.test(path) ||
  (/\.js$/.test(path) && !hasStatements(text) && /\brequire\(|\bmodule\.exports\b|^exports\./m.test(text));
const isTyped = (path: string) => /\.(?:[cm]?ts|tsx)$/.test(path);
const kindOf = (path: string) => /\.[^.]+$/.exec(path)![0].replace("x", "");
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function found(program: Program, from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const path = posix.normalize(folderOf(from) + specifier);
  return ["", ".ts", ".js", ".mjs", ".cjs", ".tsx", ".mts", ".cts", "/index.ts", "/index.js", "/index.mjs"]
    .map(more => path + more)
    .find(candidate => program.files.has(candidate));
}

/** The program with `text` in the place of [start, end) of `file`, and with more files. */
function changed(
  program: Program,
  file: string,
  start: number,
  end: number,
  text: string,
  more: [string, string][] = [],
) {
  const files = new Map(program.files);
  const old = files.get(file)!;
  files.set(file, old.slice(0, start) + text + old.slice(end));
  for (const [name, its] of more) {
    if (files.has(name)) return undefined;
    files.set(name, its);
  }
  return { files };
}

type Statement = { file: string; text: string; start: number; end: number; match: RegExpExecArray };

function* statements(
  program: Program,
  pattern: RegExp,
  fits: (file: string, text: string) => boolean,
): Generator<Statement> {
  for (const [file, text] of program.files) {
    if (!isCode(file) || !fits(file, text)) continue;
    for (const match of text.matchAll(pattern) as Iterable<RegExpExecArray>)
      yield { file, text, start: match.index, end: match.index + match[0].length, match };
  }
}

const name = "[A-Za-z_$][\\w$]*";
const from = `from\\s*(["'])([^"'\\n]+)\\QUOTE;?[ \\t]*$`;
const statement = (head: string, quote: number) =>
  new RegExp(`^${head}\\s*${from.replace("QUOTE", String(quote))}`, "gm");
const importOfNames = statement("import\\s*\\{([^}]*)\\}", 2);
const importOfDefault = statement(`import\\s+(${name})\\s`, 2);
const importOfNamespace = statement(`import\\s*\\*\\s*as\\s+(${name})\\s`, 2);
const exportOfNames = statement("export\\s*\\{([^}]*)\\}", 2);

/** `a, b as c` as [["a", "a"], ["b", "c"]], or undefined where a name is a type, a text or `default`. */
function namesOf(list: string): [string, string][] | undefined {
  const pairs = list
    .split(",")
    .map(one => one.trim())
    .filter(Boolean)
    .map(one => new RegExp(`^(${name})(?:\\s+as\\s+(${name}))?$`).exec(one));
  if (
    !pairs.length ||
    pairs.some(pair => !pair || pair[1] === "type" || pair[1] === "default" || pair[2] === "default")
  )
    return undefined;
  return pairs.map(pair => [pair![1], pair![2] ?? pair![1]]);
}
const takenApart = (pairs: [string, string][]) =>
  `{ ${pairs.map(([a, b]) => (a === b ? a : `${a}: ${b}`)).join(", ")} }`;

/** One move on each statement that `pattern` finds. */
const onStatements =
  (
    pattern: RegExp,
    fits: (file: string, text: string) => boolean,
    move: (program: Program, at: Statement) => Departed | undefined,
  ) =>
  (program: Program) =>
    [...statements(program, pattern, fits)].map(at => () => move(program, at));

const manifest = (
  program: Program,
  write: (old: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
  alone = false,
) => {
  if (
    alone
      ? !/\.[jt]s$/.test(program.entry) && program.files.size < 2
      : [...program.files.keys()].filter(isCode).length < 2
  )
    return [];
  const old = program.files.get("package.json");
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = old === undefined ? undefined : JSON.parse(old);
  } catch {
    return [];
  }
  const next = write(parsed);
  return next ? [() => ({ files: new Map(program.files).set("package.json", JSON.stringify(next) + "\n") })] : [];
};

/** A file that loads nothing and only declares what it exports: its names, and its text without the word `export`. */
function leafOfDeclarations(text: string) {
  if (/^import\b|\bimport\(|\brequire\(|^export\s*(?:\{|\*|default\b)|\bimport\.meta\b|^\s*await\b/m.test(text))
    return undefined;
  const names = [...text.matchAll(new RegExp(`^export\\s+(?:const|let|var|function\\*?|async\\s+function\\*?|class)\\s+(${name})`, "gm"))].map(match => match[1]); // prettier-ignore
  if (!names.length || names.length !== [...text.matchAll(/^export\b/gm)].length) return undefined;
  return { names, text: text.replace(/^export\s+/gm, "") };
}

/** The names that a file exports by its own declarations and lists: undefined where it hands on a star or has a default. */
function namesThatAFileDeclares(text: string) {
  if (/^export\s*\*|^export\s+default\b|\bas\s+default\b|^(?:module\.)?exports\b/m.test(text)) return undefined;
  const declared = [...text.matchAll(new RegExp(`^export\\s+(?:const|let|var|function\\*?|async\\s+function\\*?|class)\\s+(${name})`, "gm"))].map(match => match[1]); // prettier-ignore
  const listed = [...text.matchAll(/^export\s*\{([^}]*)\}/gm)].map(match => namesOf(match[1]));
  if (listed.some(list => !list)) return undefined;
  return [...new Set([...declared, ...listed.flatMap(list => list!.map(pair => pair[1]))])];
}

/** `file` goes by another name: whoever names it by a relative path names the new one. */
function renamed(program: Program, file: string, to: string, text: string, spelled?: string): Departed | undefined {
  if (program.files.has(to)) return undefined;
  const files: Files = new Map();
  const [oldBase, newBase] = [posix.basename(file), posix.basename(to)];
  let namedBy = 0;
  for (const [path, its] of program.files) {
    if (path === file) files.set(to, text);
    else
      files.set(
        path,
        isCode(path)
          ? its.replace(/(["'])(\.[^"'\n]*)\1/g, (whole, quote, specifier) => {
              if (found(program, path, specifier) !== file || !specifier.endsWith(oldBase)) return whole;
              namedBy++;
              return quote + (spelled ?? specifier.slice(0, -oldBase.length) + newBase) + quote;
            })
          : its,
      );
  }
  return namedBy ? { files } : undefined;
}

const leaves = (
  program: Program,
  fits: (file: string, text: string) => boolean,
  move: (file: string, text: string) => Departed | undefined,
) =>
  [...program.files]
    .filter(
      ([file, text]) => file !== program.entry && isCode(file) && !file.includes("node_modules/") && fits(file, text),
    )
    .map(
      ([file, text]) =>
        () =>
          move(file, text),
    );

// ---- the moves on the graph of modules

const relative = (at: Statement) => at.match[3].startsWith(".");
const beside = (at: Statement, base: string) => [
  folderOf(at.file) + base + kindOf(at.file),
  "./" + base + kindOf(at.file),
];

const graphMoves: Move[] = [
  {
    name: "a-star-beside-names-handed-on",
    places: onStatements(exportOfNames, isES, (program, at) => {
      const [path, specifier] = beside(at, "added-beside");
      return changed(program, at.file, at.end, at.end, `\nexport * from "${specifier}";`, [
        [path, "export const addedBeside = 1;\n"],
      ]);
    }),
  },
  {
    name: "a-star-for-names-handed-on",
    places: onStatements(exportOfNames, isES, (program, at) => {
      const pairs = namesOf(at.match[1]);
      return pairs?.every(([a, b]) => a === b)
        ? changed(program, at.file, at.start, at.end, `export * from "${at.match[3]}";`)
        : undefined;
    }),
  },
  {
    name: "a-namespace-for-names",
    places: onStatements(importOfNames, isES, (program, at) => {
      const pairs = namesOf(at.match[1]);
      return (
        pairs &&
        changed(
          program,
          at.file,
          at.start,
          at.end,
          `import * as departed from "${at.match[3]}";\nconst ${takenApart(pairs)} = departed;`,
        )
      );
    }),
  },
  {
    name: "a-namespace-beside-names-and-its-keys-printed",
    places: onStatements(importOfNames, isES, (program, at) => {
      const next = changed(program, at.file, at.end, at.end, `\nimport * as departed from "${at.match[3]}";`);
      next?.files.set(
        at.file,
        next.files.get(at.file)!.replace(/\n?$/, "\nconsole.log(Object.keys(departed).join());\n"),
      );
      return next;
    }),
  },
  {
    name: "no-side-effects-in-a-named-package",
    places: program =>
      manifest(program, old => (old && "sideEffects" in old ? undefined : { name: "app", ...old, sideEffects: false })),
  },
  {
    name: "no-side-effects-in-a-package-without-a-name",
    places: program => manifest(program, old => (old ? undefined : { sideEffects: false })),
  },
  {
    name: "side-effects-after-all",
    places: program =>
      manifest(program, old => (old?.sideEffects === false ? { ...old, sideEffects: true } : undefined)),
  },
  {
    name: "the-package-is-of-modules",
    places: program => manifest(program, old => (old && "type" in old ? undefined : { ...old, type: "module" }), true),
  },
  {
    name: "the-package-is-of-commonjs",
    places: program =>
      manifest(program, old => (old && "type" in old ? undefined : { ...old, type: "commonjs" }), true),
  },
  {
    name: "through-a-barrel-of-names",
    places: onStatements(importOfNames, isES, (program, at) => {
      const pairs = namesOf(at.match[1]);
      const [path, specifier] = beside(at, "added-barrel");
      if (!pairs || !relative(at)) return undefined;
      const barrel = `export { ${[...new Set(pairs.map(pair => pair[0]))].join(", ")} } from "${at.match[3]}";\n`;
      return changed(program, at.file, at.start, at.end, at.match[0].replace(at.match[3], specifier), [[path, barrel]]);
    }),
  },
  {
    name: "through-a-barrel-of-a-star",
    places: onStatements(importOfNames, isES, (program, at) => {
      const [path, specifier] = beside(at, "added-barrel");
      if (!namesOf(at.match[1]) || !relative(at)) return undefined;
      return changed(program, at.file, at.start, at.end, at.match[0].replace(at.match[3], specifier), [
        [path, `export * from "${at.match[3]}";\n`],
      ]);
    }),
  },
  {
    name: "names-imported-at-run-time",
    places: onStatements(importOfNames, isES, (program, at) => {
      const pairs = namesOf(at.match[1]);
      return (
        pairs &&
        changed(program, at.file, at.start, at.end, `const ${takenApart(pairs)} = await import("${at.match[3]}");`)
      );
    }),
  },
  {
    name: "a-default-imported-at-run-time",
    places: onStatements(importOfDefault, isES, (program, at) =>
      at.match[1] === "type"
        ? undefined
        : changed(
            program,
            at.file,
            at.start,
            at.end,
            `const { default: ${at.match[1]} } = await import("${at.match[3]}");`,
          ),
    ),
  },
  {
    name: "a-namespace-imported-at-run-time",
    places: onStatements(importOfNamespace, isES, (program, at) =>
      changed(program, at.file, at.start, at.end, `const ${at.match[1]} = await import("${at.match[3]}");`),
    ),
  },
  {
    name: "names-required",
    places: onStatements(
      importOfNames,
      (file, text) => isES(file, text) && !isTyped(file),
      (program, at) => {
        const pairs = namesOf(at.match[1]);
        return (
          pairs &&
          changed(program, at.file, at.start, at.end, `const ${takenApart(pairs)} = require("${at.match[3]}");`)
        );
      },
    ),
  },
  {
    name: "loaded-for-nothing-in-front",
    places: onStatements(importOfNames, isES, (program, at) =>
      changed(program, at.file, at.start, at.start, `import "${at.match[3]}";\n`),
    ),
  },
  {
    name: "a-ring-by-a-statement",
    places: onStatements(importOfNames, isES, (program, at) => {
      const target = found(program, at.file, at.match[3]);
      if (!target || !isES(target, program.files.get(target)!)) return undefined;
      const back = posix.relative(folderOf(target) || ".", at.file);
      return changed(program, target, 0, 0, `import "${back.startsWith(".") ? back : "./" + back}";\n`);
    }),
  },
  {
    name: "a-ring-of-stars",
    places: onStatements(exportOfNames, isES, (program, at) => {
      const target = found(program, at.file, at.match[3]);
      if (!target || !isES(target, program.files.get(target)!)) return undefined;
      const back = posix.relative(folderOf(target) || ".", at.file);
      return changed(program, target, 0, 0, `export * from "${back.startsWith(".") ? back : "./" + back}";\n`);
    }),
  },
  {
    name: "a-commonjs-file-for-an-es-file",
    places: program =>
      leaves(program, (file, text) => /\.mjs$/.test(file) && !!leafOfDeclarations(text), (file, text) => {
        const leaf = leafOfDeclarations(text)!;
        return renamed(program, file, file.replace(/\.mjs$/, ".cjs"), leaf.text.replace(/\n?$/, `\nmodule.exports = { ${leaf.names.join(", ")} };\n`));
      }), // prettier-ignore
  },
  {
    name: "a-commonjs-file-whose-exports-are-a-function-for-an-es-file",
    places: program =>
      leaves(program, (file, text) => /\.mjs$/.test(file) && !!leafOfDeclarations(text), (file, text) => {
        const leaf = leafOfDeclarations(text)!;
        const members = leaf.names.map(one => `module.exports.${one} = ${one};`).join("\n");
        return renamed(program, file, file.replace(/\.mjs$/, ".cjs"), leaf.text.replace(/\n?$/, `\nmodule.exports = function () {};\n${members}\n`));
      }), // prettier-ignore
  },
  {
    name: "an-es-file-for-a-commonjs-file",
    places: program =>
      leaves(
        program,
        (file, text) => {
          const members = [...text.matchAll(new RegExp(`^(?:module\\.)?exports\\.(${name}) = `, "gm"))].map(
            match => match[1],
          );
          return (
            /\.cjs$/.test(file) &&
            members.length > 0 &&
            new Set(members).size === members.length &&
            members.length === [...text.matchAll(/\bexports\b/g)].length &&
            !/\brequire\b|\b__filename\b|\b__dirname\b|\bthis\b|\bmodule\b(?!\.exports\.)|\barguments\b|^\s*return\b/m.test(
              text,
            ) &&
            !members.some(one =>
              new RegExp(`(?:const|let|var|function|class)\\s+${one.replace("$", "\\$")}\\b`).test(text),
            )
          );
        },
        (file, text) =>
          renamed(
            program,
            file,
            file.replace(/\.cjs$/, ".mjs"),
            text.replace(new RegExp(`^(?:module\\.)?exports\\.(${name}) = `, "gm"), "export const $1 = "),
          ),
      ),
  },
  {
    name: "the-exports-are-a-function-with-members",
    places: onStatements(/^module\.exports = (\{[^{}]*\});?[ \t]*$/gm, isCommonJS, (program, at) =>
      changed(
        program,
        at.file,
        at.start,
        at.end,
        `module.exports = function () {};\nObject.assign(module.exports, ${at.match[1]});`,
      ),
    ),
  },
  {
    name: "members-laid-onto-the-exports",
    places: onStatements(/^module\.exports = (\{[^{}]*\});?[ \t]*$/gm, isCommonJS, (program, at) =>
      changed(program, at.file, at.start, at.end, `Object.assign(module.exports, ${at.match[1]});`),
    ),
  },
  {
    name: "a-star-of-a-commonjs-file-beside-names-handed-on",
    places: onStatements(exportOfNames, isES, (program, at) =>
      changed(program, at.file, at.end, at.end, '\nexport * from "./added-beside.cjs";', [
        [folderOf(at.file) + "added-beside.cjs", "exports.addedBeside = 1;\n"],
      ]),
    ),
  },
  {
    name: "names-for-a-star-handed-on",
    places: onStatements(statement("export\\s*\\*", 1), isES, (program, at) => {
      const target = found(program, at.file, at.match[2]);
      const names = target && namesThatAFileDeclares(program.files.get(target)!);
      return names?.length
        ? changed(program, at.file, at.start, at.end, `export { ${names.join(", ")} } from "${at.match[2]}";`)
        : undefined;
    }),
  },
  {
    name: "a-namespace-handed-on-for-a-namespace-imported",
    places: onStatements(importOfNamespace, isES, (program, at) => {
      const [path, specifier] = beside(at, "added-barrel");
      if (!relative(at)) return undefined;
      return changed(program, at.file, at.start, at.end, `import { ${at.match[1]} } from "${specifier}";`, [
        [path, `export * as ${at.match[1]} from "${at.match[3]}";\n`],
      ]);
    }),
  },
  {
    name: "a-statement-for-a-namespace-imported-at-run-time",
    places: onStatements(
      new RegExp(`^const (${name}) = await import\\((["'])([^"'\\n]+)\\2\\);?[ \\t]*$`, "gm"),
      isES,
      (program, at) => changed(program, at.file, at.start, at.end, `import * as ${at.match[1]} from "${at.match[3]}";`),
    ),
  },
  {
    name: "no-side-effects-by-an-empty-list",
    places: program =>
      manifest(program, old => (old && "sideEffects" in old ? undefined : { name: "app", ...old, sideEffects: [] })),
  },
  {
    name: "no-side-effects-in-a-library",
    places: program =>
      [...program.files]
        .filter(([file, text]) => /^node_modules\/[^/]+\/package\.json$/.test(file) && !text.includes('"sideEffects"'))
        .map(([file, text]) => () => ({
          files: new Map(program.files).set(file, JSON.stringify({ ...JSON.parse(text), sideEffects: false }) + "\n"),
        })),
  },
  {
    name: "members-on-a-function-for-members-on-the-exports",
    places: program =>
      leaves(
        program,
        (file, text) =>
          isCommonJS(file, text) && /^exports\.[\w$]+ = /m.test(text) && !/\bmodule\.exports\b/.test(text),
        (file, text) => ({
          files: new Map(program.files).set(
            file,
            "module.exports = function () {};\n" + text.replace(/\bexports\./g, "module.exports."),
          ),
        }),
      ),
  },
  {
    name: "the-file-is-a-package",
    places: program =>
      leaves(
        program,
        (file, text) =>
          !/["']\.\.?\//.test(text) && !/\b__filename\b|\b__dirname\b|\bimport\.meta\b/.test(text) && !isTyped(file),
        (file, text) => {
          const main = "index" + kindOf(file);
          const next = renamed(program, file, "node_modules/departed/" + main, text, "departed");
          next?.files.set(
            "node_modules/departed/package.json",
            JSON.stringify({ name: "departed", version: "1.0.0", main }) + "\n",
          );
          return next;
        },
      ),
  },
  {
    name: "behind-an-entry-that-imports-it-at-run-time",
    places: program => [
      () => ({
        entry: "departed-entry.mjs",
        files: new Map(program.files).set("departed-entry.mjs", `await import("./${program.entry}");\n`),
      }),
    ],
  },
  {
    name: "behind-an-entry-that-imports-it-by-a-statement",
    places: program => [
      () => ({
        entry: "departed-entry.mjs",
        files: new Map(program.files).set("departed-entry.mjs", `import "./${program.entry}";\n`),
      }),
    ],
  },
];

// ---- the moves on loops

/** Where the block that opens at `open` closes, or -1. Texts, templates, comments and regular expressions are passed over. */
function endOfBlock(text: string, open: number): number {
  let depth = 0;
  let last = "";
  for (let at = open; at < text.length; at++) {
    const one = text[at];
    if (one === '"' || one === "'") {
      for (at++; at < text.length && text[at] !== one; at++) {
        if (text[at] === "\\") at++;
        else if (text[at] === "\n") return -1;
      }
    } else if (one === "`") {
      for (at++; at < text.length && text[at] !== "`"; at++) {
        if (text[at] === "\\") at++;
        else if (text[at] === "$" && text[at + 1] === "{") {
          at = endOfBlock(text, at + 1);
          if (at < 0) return -1;
        }
      }
    } else if (one === "/" && text[at + 1] === "/")
      at = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    else if (one === "/" && text[at + 1] === "*") {
      at = text.indexOf("*/", at + 2) + 1;
      if (at < 1) return -1;
    } else if (one === "/" && (last === "" || "(,=:[!&|?{};\n".includes(last))) {
      let inClass = false;
      for (at++; at < text.length && (inClass || text[at] !== "/"); at++) {
        if (text[at] === "\\") at++;
        else if (text[at] === "[") inClass = true;
        else if (text[at] === "]") inClass = false;
        else if (text[at] === "\n") return -1;
      }
    } else if (one === "{") depth++;
    else if (one === "}" && --depth === 0) return at;
    if (!/[ \t]/.test(text[at] ?? "")) last = text[at] ?? "";
  }
  return -1;
}

// `for (keyword counter = start; counter sign bound; step)`. [start of the match, end) is the head. [from, to) is the turn: a block, or one statement that ends its line.
type Loop = Statement & {
  up: boolean;
  keyword: string;
  counter: string;
  first: string;
  sign: string;
  bound: string;
  from: number;
  to: number;
  inner: number;
  body: string;
};

const upward = new RegExp(
  `\\bfor \\((let|var) (${name}) = ([^;,\\n]+?); ?\\2 (<=?) ([^;\\n]+?); ?(?:\\2\\+\\+|\\+\\+\\2|\\2 \\+= 1)\\)`,
  "g",
);
const downward = new RegExp(
  `\\bfor \\((let|var) (${name}) = ([^;,\\n]+?); ?\\2 (>=?) ([^;\\n]+?); ?(?:\\2--|--\\2|\\2 -= 1)\\)`,
  "g",
);
const escaped = (text: string) => text.replace(/[$]/g, "\\$");
const isVariableOrNumber = (text: string) => new RegExp(`^(?:${name}|-?\\d+)$`).test(text);

function* loops(program: Program, up: boolean): Generator<Loop> {
  for (const at of statements(program, up ? upward : downward, () => true)) {
    const [, keyword, counter, first, sign, bound] = at.match;
    if (/\(/.test(bound + first) || /[\w$]:\s*$/.test(at.text.slice(0, at.start))) continue;
    const from = at.end + /^[ \t]*\n?[ \t]*/.exec(at.text.slice(at.end))![0].length;
    let [to, inner, body] = [0, 0, ""];
    if (at.text[from] === "{") {
      to = endOfBlock(at.text, from) + 1;
      if (!to) continue;
      [inner, body] = [from + 1, at.text.slice(from + 1, to - 1)];
    } else {
      const line = /^[^\n{}]*;[ \t]*(?=\n|$)/.exec(at.text.slice(from));
      if (!line || /^(?:for|while|do|if|switch|try)\b/.test(line[0])) continue;
      [to, inner, body] = [from + line[0].length, from, line[0]];
    }
    // The turn leaves the counter alone, and what the head names besides stays as it is.
    if (
      new RegExp(
        `(?:\\+\\+|--)\\s*${escaped(counter)}\\b|\\b${escaped(counter)}\\s*(?:\\+\\+|--|[-+*/%&|^]?=(?!=)|<<=|>>=|>>>=|\\*\\*=)`,
      ).test(body)
    )
      continue;
    const roots = [...(bound + " " + first).matchAll(new RegExp(name, "g"))].map(match => match[0]);
    if (
      roots.some(root =>
        new RegExp(
          `\\b${escaped(root)}\\b\\s*(?:\\.\\s*(?:push|pop|shift|unshift|splice|length\\s*=|add|set|delete)\\b|\\[[^\\]]*\\]\\s*[-+*/]?=(?!=)|(?:\\+\\+|--|[-+*/%]?=(?!=)))`,
        ).test(body),
      )
    )
      continue;
    yield { ...at, up, keyword, counter, first, sign, bound, from, to, inner, body };
  }
}

const bothWays = (
  base: string,
  move: (program: Program, loop: Loop) => Departed | undefined,
  ways: boolean[] = [true, false],
): Move[] =>
  ways.map(up => ({
    name: base + (up || ways.length < 2 ? "" : "-of-a-loop-that-counts-down"),
    places: program => [...loops(program, up)].map(loop => () => move(program, loop)),
  }));
const simple = (text: string) => (new RegExp(`^${name}(?:\\.${name})*$|^\\d+$`).test(text) ? text : `(${text})`);
const head = (program: Program, loop: Loop, text: string) => changed(program, loop.file, loop.start, loop.end, text);
const whole = (program: Program, loop: Loop, text: string) => changed(program, loop.file, loop.start, loop.to, text);
const headOf = (loop: Loop) => loop.text.slice(loop.start, loop.end);
const step = (loop: Loop) => loop.counter + (loop.up ? "++" : "--");
const asked = (loop: Loop) => `${loop.counter} ${loop.sign} ${loop.bound}`;

/** Each `list[counter]` in the turn of a loop that counts. `stores`: those that are stored to, or those that are only read. */
function* elements(program: Program, stores: boolean): Generator<[Loop, number]> {
  for (const up of [true, false])
    for (const loop of loops(program, up))
      for (const match of loop.body.matchAll(
        new RegExp(
          `\\b(${name})(?:\\.${name})*\\[${escaped(loop.counter)}\\](\\s*(?:[-+*/%|&^]?=(?!=)|\\+\\+|--))?`,
          "g",
        ),
      )) {
        // Two names may stand for one list: a store moves only where the bound is a variable or a number.
        if (!!match[2] !== stores || (stores && !isVariableOrNumber(loop.bound))) continue;
        yield [loop, loop.inner + match.index + match[0].length - (match[2]?.length ?? 0) - 1];
      }
}
const onElements = (stores: boolean, more: string) => (program: Program) =>
  [...elements(program, stores)].map(
    ([loop, at]) =>
      () =>
        changed(program, loop.file, at, at, more),
  );

const keptByAnIf = new RegExp(`\\bif \\(([^()\\n]+?) (>|<) (${name})\\) \\3 = \\1;`, "g");

const loopMoves: Move[] = [
  ...bothWays(
    "down-for-up",
    (program, loop) =>
      head(
        program,
        loop,
        `for (${loop.keyword} ${loop.counter} = ${loop.sign === "<" ? simple(loop.bound) + " - 1" : loop.bound}; ${loop.counter} >= ${loop.first}; ${loop.counter}--)`,
      ),
    [true],
  ),
  ...bothWays(
    "up-for-down",
    (program, loop) =>
      head(
        program,
        loop,
        `for (${loop.keyword} ${loop.counter} = ${loop.sign === ">" ? simple(loop.bound) + " + 1" : loop.bound}, departedEnd = ${loop.first}; ${loop.counter} <= departedEnd; ${loop.counter}++)`,
      ),
    [false],
  ),
  { name: "stored-one-place-further", places: onElements(true, " + 1") },
  { name: "stored-one-place-back", places: onElements(true, " - 1") },
  { name: "stored-two-places-further", places: onElements(true, " + 2") },
  { name: "read-one-place-further", places: onElements(false, " + 1") },
  { name: "read-one-place-back", places: onElements(false, " - 1") },
  ...bothWays("the-other-sign-in-the-question", (program, loop) =>
    head(
      program,
      loop,
      headOf(loop).replace(
        asked(loop),
        `${loop.counter} ${loop.sign.length > 1 ? loop.sign[0] : loop.sign + "="} ${simple(loop.bound)} ${loop.sign.length > 1 === loop.up ? "+" : "-"} 1`,
      ),
    ),
  ),
  ...bothWays("the-bound-read-once", (program, loop) =>
    /^-?\d+$/.test(loop.bound)
      ? undefined
      : head(
          program,
          loop,
          `for (${loop.keyword} ${loop.counter} = ${loop.first}, departedEnd = ${loop.bound}; ${loop.counter} ${loop.sign} departedEnd; ${step(loop)})`,
        ),
  ),
  ...bothWays("the-other-keyword", (program, loop) =>
    head(program, loop, headOf(loop).replace(/^for \((?:let|var) /, `for (${loop.keyword === "let" ? "var" : "let"} `)),
  ),
  ...bothWays("two-at-a-time", (program, loop) =>
    head(
      program,
      loop,
      `for (${loop.keyword} ${loop.counter} = ${loop.first}; ${asked(loop)}; ${loop.counter} ${loop.up ? "+" : "-"}= 2)`,
    ),
  ),
  ...bothWays("begun-one-later", (program, loop) =>
    head(
      program,
      loop,
      `for (${loop.keyword} ${loop.counter} = ${simple(loop.first)} ${loop.up ? "+" : "-"} 1; ${asked(loop)}; ${step(loop)})`,
    ),
  ),
  ...bothWays("a-while-for-the-for", (program, loop) =>
    /\bcontinue\b/.test(loop.body)
      ? undefined
      : whole(
          program,
          loop,
          `{\n${loop.keyword} ${loop.counter} = ${loop.first};\nwhile (${asked(loop)}) {\n${loop.body}\n${step(loop)};\n}\n}`,
        ),
  ),
  ...bothWays("a-do-while-for-the-for", (program, loop) =>
    /\bcontinue\b/.test(loop.body)
      ? undefined
      : whole(
          program,
          loop,
          `{\n${loop.keyword} ${loop.counter} = ${loop.first};\nif (${asked(loop)})\ndo {\n${loop.body}\n${step(loop)};\n} while (${asked(loop)});\n}`,
        ),
  ),
  ...bothWays("a-try-in-the-turn", (program, loop) =>
    whole(program, loop, `${headOf(loop)} {\ntry {\n${loop.body}\n} catch (departed) {\nthrow departed;\n}\n}`),
  ),
  ...bothWays("a-finally-in-the-turn", (program, loop) =>
    whole(program, loop, `${headOf(loop)} {\ntry {\n${loop.body}\n} finally {\nString(${loop.counter});\n}\n}`),
  ),
  ...bothWays("a-try-round-the-loop", (program, loop) =>
    whole(program, loop, `try {\n${headOf(loop)} {\n${loop.body}\n}\n} catch (departed) {\nthrow departed;\n}`),
  ),
  ...bothWays("what-is-kept-is-stored-under-the-counter", (program, loop) => {
    const kept =
      new RegExp(keptByAnIf.source).exec(loop.body)?.[3] ??
      new RegExp(`\\b(${name}) = (?:Math\\.(?:max|min)\\(\\1, |[^;\\n]+ \\? [^;\\n]+ : \\1;)`).exec(loop.body)?.[1];
    if (!kept || loop.body.includes("departedKept") || !/(?:^|[;{}])\s*$/.test(loop.text.slice(0, loop.start)))
      return undefined;
    return whole(
      program,
      loop,
      `const departedKept = [];\n${headOf(loop)} {\n${loop.body}\ndepartedKept[${loop.counter}] = ${kept};\n}\nconsole.log(departedKept.join());`,
    );
  }),
  {
    name: "an-if-for-the-greater-of-two",
    places: onStatements(
      new RegExp(`\\b(${name}) = Math\\.(max|min)\\(\\1, ([^;()\\n]+)\\);`, "g"),
      () => true,
      (program, at) =>
        changed(
          program,
          at.file,
          at.start,
          at.end,
          `if (${at.match[3]} ${at.match[2] === "max" ? ">" : "<"} ${at.match[1]}) ${at.match[1]} = ${at.match[3]};`,
        ),
    ),
  },
  {
    name: "the-greater-of-two-for-an-if",
    places: onStatements(
      keptByAnIf,
      () => true,
      (program, at) =>
        changed(
          program,
          at.file,
          at.start,
          at.end,
          `${at.match[3]} = Math.${at.match[2] === ">" ? "max" : "min"}(${at.match[3]}, ${at.match[1]});`,
        ),
    ),
  },
  {
    name: "a-choice-for-an-if",
    places: onStatements(
      keptByAnIf,
      () => true,
      (program, at) =>
        changed(
          program,
          at.file,
          at.start,
          at.end,
          `${at.match[3]} = ${at.match[1]} ${at.match[2]} ${at.match[3]} ? ${at.match[1]} : ${at.match[3]};`,
        ),
    ),
  },
  {
    name: "anything-for-a-declared-list",
    places: onStatements(/: (?:number|string)\[\](?=[,)= ;])/g, isTyped, (program, at) =>
      changed(program, at.file, at.start, at.end, ": any"),
    ),
  },
  {
    name: "a-parsed-list-for-a-written-one",
    places: onStatements(
      /\[(-?\d+(?:\.\d+)?(?:, -?\d+(?:\.\d+)?)+)\](?!\s*(?:=(?!=)|\]))/g,
      () => true,
      (program, at) =>
        /["'`]/.test(
          at.text.slice(at.text.lastIndexOf("\n", at.start) + 1, at.start).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ""),
        )
          ? undefined
          : changed(program, at.file, at.start, at.end, `JSON.parse("[${at.match[1].replaceAll(" ", "")}]")`),
    ),
  },
  {
    name: "a-parsed-empty-list-for-a-written-one",
    places: onStatements(
      / = \[\];/g,
      () => true,
      (program, at) => changed(program, at.file, at.start, at.end, ' = JSON.parse("[]");'),
    ),
  },
  {
    name: "a-list-of-a-length-for-an-empty-one",
    places: onStatements(
      / = \[\];/g,
      () => true,
      (program, at) => changed(program, at.file, at.start, at.end, " = new Array(3);"),
    ),
  },
  // The program as it is stored: whoever reads a table leaves out what comes of a program that by itself does not answer as plain Bun does.
  { name: "nothing-moved", places: program => [() => ({ files: program.files })] },
];

// ---- the row

const only = (pattern: string | undefined) => (move: Move) => !pattern || new RegExp(pattern).test(move.name);
const moves = [...graphMoves, ...loopMoves].filter(only(process.env.MOVES));
const wanted = process.env.SEEDS_WITH ? [...graphMoves, ...loopMoves].filter(only(process.env.SEEDS_WITH)) : [];
const programs = stored
  .flatMap(folder => [...programsBelow(folder, "")])
  .filter(program => !wanted.length || wanted.some(move => move.places(program).some(place => place())));
// For each move, for each program: where its places begin in the row.
const begins: number[][] = [];
let all = 0;
for (const move of moves) {
  const ofMove: number[] = [];
  for (const program of programs) {
    ofMove.push(all);
    all += move.places(program).length;
  }
  begins.push(ofMove);
}

function placeOf(at: number) {
  let move = moves.length - 1;
  while (begins[move][0] > at) move--;
  const ofMove = begins[move];
  let [low, high] = [0, ofMove.length - 1];
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (ofMove[middle] <= at) low = middle;
    else high = middle - 1;
  }
  return { move: moves[move], program: programs[low], place: at - ofMove[low] };
}

const short = (text: string, most: number) => (text.length <= most ? text : text.slice(0, most - 1) + "~");
function nameOf(at: number) {
  const { move, program, place } = placeOf(at);
  const [family, ...rest] = program.path.replace(/\.[^./]+$/, "").split("/");
  return `${move.name}--${place}--${short(family, 50)}--${short(rest.join("+") || "main", 70)}`;
}

/** Undefined where the move does not fit after all: the place stays in the row, so that the row is the same for whoever only counts. */
function write(at: number): { name: string; text: string } | undefined {
  const { move, program, place } = placeOf(at);
  const departed = move.places(program)[place]();
  if (!departed) return undefined;
  const entry = departed.entry ?? (departed.files.has(program.entry) ? program.entry : undefined);
  if (!entry) return undefined;
  const parts = [`// @entry: ./${entry}`, departed.files.get(entry)!.replace(/\n$/, "")];
  for (const [path, text] of departed.files)
    if (path !== entry) parts.push(`// @filename: ./${path}`, text.replace(/\n$/, ""));
  return { name: nameOf(at) + /\.[^.]+$/.exec(entry)![0], text: parts.join("\n") + "\n" };
}

const pad = (at: number) => String(at).padStart(7, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "moves") {
  console.log(`${programs.length} stored programs`);
  moves.forEach((move, at) =>
    console.log(`${begins[at][0]}\t${(begins[at + 1]?.[0] ?? all) - begins[at][0]}\t${move.name}`),
  );
} else if (process.argv[2] === "where") {
  const { move, program, place } = placeOf(Number(process.argv[3]));
  console.log(`${program.path}\t${move.name}\t${place}`);
} else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    if (!pattern.test(nameOf(at))) continue;
    const program = write(at);
    if (!program) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    if (!program) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
}

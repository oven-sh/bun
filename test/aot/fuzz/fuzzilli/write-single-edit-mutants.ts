// Generates mutants of seed programs. A mutant is a seed with one edit applied. Every mutation in the table is applied at every site where it matches, one site per mutant.
// The seeds are the small programs under ../../parallel and every program under ./textbook. Each mutant is built on its own, and its output must match `bun <file>`.
// A seed is known to work, and a mutant is what somebody might write next: a descending loop instead of an ascending one, `i + 1` instead of `i`, a CommonJS file instead of an
// ES module, an extra `export *`, a new field in package.json, `import * as` instead of named imports.
//
//   bun write-single-edit-mutants.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<mutation>--<site>--<group>--<seed>.<extension>
//   bun write-single-edit-mutants.ts count
//   bun write-single-edit-mutants.ts named <pattern> <folder> [limit]
//   bun write-single-edit-mutants.ts mutations      prints one line per mutation: the number of its first mutant, and its number of sites
//   bun write-single-edit-mutants.ts where <n>      prints the seed, the mutation and the site of mutant <n>
//
// In a file name, <group> is the first segment of the seed's path under its root, and <seed> is the rest of the path, or `main` if there is none.
// The programs under ../../parallel are regression tests: few of their loops count down, carry a value across iterations or fill a second array. ./textbook holds textbook programs: prefix sums,
// running maximums, sorting, tables filled row by row. SEED_ROOTS=<folders> reads the seeds from other folders, separated by colons. In every root, a folder with a main file is one seed, and any
// other file is a seed by itself. One file may hold a multi-file seed, with each file after a `// @filename: ./x` line, which is the format the other generators here write.
// MUTATIONS=<pattern> keeps only the mutations whose names match. SEED_FILTER=<pattern> keeps only the seeds where a mutation with a matching name applies.
// Mutants are numbered by mutation: module graph mutations first, then loop mutations, then object mutations, then the unchanged seeds.
// The output folder is itself a valid seed root, so running the generator on its own output applies a second edit.
//
// Every mutant terminates. A loop is reversed only if its body does not write the counter, and a store index moves only if the loop bound is a variable or a number, not a length.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, posix } from "path";

type Files = Map<string, string>;
type Seed = { path: string; entry: string; files: Files };
type Mutant = { entry?: string; files: Files };
// A site is one place in a seed where a mutation matches. Calling it returns the mutant, or undefined if the mutation turns out not to apply.
type Mutation = { name: string; findSites(seed: Seed): (() => Mutant | undefined)[] };

const seedRoots = (
  process.env.SEED_ROOTS ?? join(import.meta.dir, "..", "..", "parallel") + ":" + join(import.meta.dir, "textbook")
).split(":");

// ---- Seed programs

const isCodeFile = (path: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
const isTextFile = (path: string) =>
  isCodeFile(path) || /\.(?:json|txt|toml|css|html|md)$/.test(path) || /\.d\.[cm]?ts$/.test(path);
// Matches a header directive that controls how the seed is built or run, and anything that depends on the clock, the machine, the garbage collector or another process.
const excludedSeedPattern =
  /^\/\/ (?:Sizes|Passes|Grows|Env[^:\n]*|Flags|Reference|It writes a program|Build prints[^:\n]*|Entry points|Todo[^:\n]*|Runs by itself|Prints what[^:\n]*|No build under[^:\n]*|It sends bytes|The output is stored):|\b(?:Worker|Bun\.serve|Bun\.spawn\w*|child_process|cluster|setInterval|performance|Date\.now|new Date\(\)|Math\.random|hrtime|WeakRef|FinalizationRegistry|Bun\.gc|memoryUsage|node:http\w*|node:net|node:vm|fetch|execPath|stdin|mainModule|bun:test|bun:jsc)\b|\brequire\s*\.\s*main\b|\bmeta\s*\.\s*main\b|\bmodule\s*\.\s*parent\b|^#!|\r/m;
const [maxBytes, maxFiles] = [24_000, 24];

function listFiles(folder: string, prefix = ""): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap(entry =>
      entry.isDirectory() ? listFiles(join(folder, entry.name), prefix + entry.name + "/") : [prefix + entry.name],
    );
}

/** Returns the seed in an array, or an empty array if the seed is excluded. */
function acceptSeed(path: string, entry: string, files: Files): Seed[] {
  let bytes = 0;
  for (const [name, source] of files) {
    bytes += source.length;
    if (/\s/.test(name) || excludedSeedPattern.test(source)) return [];
  }
  if (bytes > maxBytes || files.size > maxFiles) return [];
  const seed = { path, entry, files };
  // Every relative specifier must resolve to one of the seed's own files.
  for (const [name, source] of files)
    if (isCodeFile(name))
      for (const [, specifier] of source.matchAll(
        /(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*["'](\.\.?\/[^"'\n]+)["']/g,
      ))
        if (!resolveSpecifier(seed, name, specifier)) return [];
  return [seed];
}

function* readSeeds(folder: string, path: string): Generator<Seed> {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const mainFile = entries.find(entry => entry.isFile() && /^main\.[^.]+$/.test(entry.name) && isCodeFile(entry.name));
  if (mainFile) {
    const names = listFiles(folder);
    if (names.length <= maxFiles && names.every(isTextFile))
      yield* acceptSeed(
        path,
        mainFile.name,
        new Map(names.map(name => [name, readFileSync(join(folder, name), "utf8")])),
      );
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const childPath = path ? path + "/" + entry.name : entry.name;
    if (entry.isDirectory()) yield* readSeeds(join(folder, entry.name), childPath);
    else if (isCodeFile(entry.name)) {
      const lines = readFileSync(join(folder, entry.name), "utf8").split("\n");
      const entryDirective = /^\/\/ @entry: \.\/(\S+)$/.exec(lines[0]);
      if (entryDirective) lines.shift();
      const entryName = entryDirective?.[1] ?? "main" + /\.[^.]+$/.exec(entry.name)![0];
      const sections = new Map<string, string[]>([[entryName, []]]);
      let currentSection = sections.get(entryName)!;
      for (const line of lines) {
        const filenameDirective = /^\/\/ @filename: \.\/(\S+)/.exec(line);
        if (filenameDirective) sections.set(filenameDirective[1], (currentSection = []));
        else currentSection.push(line);
      }
      yield* acceptSeed(
        childPath,
        entryName,
        new Map([...sections].map(([name, section]) => [name, section.join("\n")])),
      );
    }
  }
}

// ---- Shared helpers

const hasModuleSyntax = (source: string) => /^(?:import\b(?!\s*\()|export\b)/m.test(source);
const isESModule = (path: string, source: string) =>
  /\.m[jt]s$/.test(path) || (/\.(?:[jt]s|[jt]sx)$/.test(path) && hasModuleSyntax(source));
const isCommonJS = (path: string, source: string) =>
  /\.c[jt]s$/.test(path) ||
  (/\.js$/.test(path) && !hasModuleSyntax(source) && /\brequire\(|\bmodule\.exports\b|^exports\./m.test(source));
const isTypeScript = (path: string) => /\.(?:[cm]?ts|tsx)$/.test(path);
// `.tsx` and `.jsx` count as `.ts` and `.js`.
const extensionOf = (path: string) => /\.[^.]+$/.exec(path)![0].replace("x", "");
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function resolveSpecifier(seed: Seed, importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const path = posix.normalize(folderOf(importer) + specifier);
  return ["", ".ts", ".js", ".mjs", ".cjs", ".tsx", ".mts", ".cts", "/index.ts", "/index.js", "/index.mjs"]
    .map(suffix => path + suffix)
    .find(candidate => seed.files.has(candidate));
}

/** Replaces [start, end) of `file` with `replacement` and adds `newFiles`. Returns undefined if a new file already exists. */
function replaceRange(
  seed: Seed,
  file: string,
  start: number,
  end: number,
  replacement: string,
  newFiles: [string, string][] = [],
) {
  const files = new Map(seed.files);
  const source = files.get(file)!;
  files.set(file, source.slice(0, start) + replacement + source.slice(end));
  for (const [name, content] of newFiles) {
    if (files.has(name)) return undefined;
    files.set(name, content);
  }
  return { files };
}

type SourceMatch = { file: string; source: string; start: number; end: number; captures: RegExpExecArray };

function* findMatches(
  seed: Seed,
  pattern: RegExp,
  fileFilter: (file: string, source: string) => boolean,
): Generator<SourceMatch> {
  for (const [file, source] of seed.files) {
    if (!isCodeFile(file) || !fileFilter(file, source)) continue;
    for (const captures of source.matchAll(pattern) as Iterable<RegExpExecArray>)
      yield { file, source, start: captures.index, end: captures.index + captures[0].length, captures };
  }
}

const identifier = "[A-Za-z_$][\\w$]*";
const fromClause = `from\\s*(["'])([^"'\\n]+)\\QUOTE;?[ \\t]*$`;
const createFromPattern = (prefix: string, quoteGroup: number) =>
  new RegExp(`^${prefix}\\s*${fromClause.replace("QUOTE", String(quoteGroup))}`, "gm");
const namedImportPattern = createFromPattern("import\\s*\\{([^}]*)\\}", 2);
const defaultImportPattern = createFromPattern(`import\\s+(${identifier})\\s`, 2);
const namespaceImportPattern = createFromPattern(`import\\s*\\*\\s*as\\s+(${identifier})\\s`, 2);
const namedReexportPattern = createFromPattern("export\\s*\\{([^}]*)\\}", 2);

/** Parses `a, b as c` into [["a", "a"], ["b", "c"]]. Returns undefined if a specifier is a type, a string or `default`. */
function parseSpecifiers(list: string): [string, string][] | undefined {
  const matches = list
    .split(",")
    .map(specifier => specifier.trim())
    .filter(Boolean)
    .map(specifier => new RegExp(`^(${identifier})(?:\\s+as\\s+(${identifier}))?$`).exec(specifier));
  if (
    !matches.length ||
    matches.some(match => !match || match[1] === "type" || match[1] === "default" || match[2] === "default")
  )
    return undefined;
  return matches.map(match => [match![1], match![2] ?? match![1]]);
}
const toDestructuringPattern = (specifiers: [string, string][]) =>
  `{ ${specifiers.map(([imported, local]) => (imported === local ? imported : `${imported}: ${local}`)).join(", ")} }`;

/** One site per match of `pattern`. */
const forEachMatch =
  (
    pattern: RegExp,
    fileFilter: (file: string, source: string) => boolean,
    mutate: (seed: Seed, match: SourceMatch) => Mutant | undefined,
  ) =>
  (seed: Seed) =>
    [...findMatches(seed, pattern, fileFilter)].map(match => () => mutate(seed, match));

const editPackageJson = (
  seed: Seed,
  edit: (existing: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
  allowsSingleFile = false,
) => {
  if (
    allowsSingleFile
      ? !/\.[jt]s$/.test(seed.entry) && seed.files.size < 2
      : [...seed.files.keys()].filter(isCodeFile).length < 2
  )
    return [];
  const json = seed.files.get("package.json");
  let existing: Record<string, unknown> | undefined;
  try {
    existing = json === undefined ? undefined : JSON.parse(json);
  } catch {
    return [];
  }
  const edited = edit(existing);
  return edited ? [() => ({ files: new Map(seed.files).set("package.json", JSON.stringify(edited) + "\n") })] : [];
};

/** For a module that imports nothing and exports only declarations: the exported names, and the source without the `export` keywords. */
function parseLeafModule(source: string) {
  if (/^import\b|\bimport\(|\brequire\(|^export\s*(?:\{|\*|default\b)|\bimport\.meta\b|^\s*await\b/m.test(source))
    return undefined;
  const names = [...source.matchAll(new RegExp(`^export\\s+(?:const|let|var|function\\*?|async\\s+function\\*?|class)\\s+(${identifier})`, "gm"))].map(match => match[1]); // prettier-ignore
  if (!names.length || names.length !== [...source.matchAll(/^export\b/gm)].length) return undefined;
  return { names, source: source.replace(/^export\s+/gm, "") };
}

/** The names a module exports through declarations and export lists. Returns undefined if it has a star re-export or a default export. */
function collectExportedNames(source: string) {
  if (/^export\s*\*|^export\s+default\b|\bas\s+default\b|^(?:module\.)?exports\b/m.test(source)) return undefined;
  const declared = [...source.matchAll(new RegExp(`^export\\s+(?:const|let|var|function\\*?|async\\s+function\\*?|class)\\s+(${identifier})`, "gm"))].map(match => match[1]); // prettier-ignore
  const listed = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].map(match => parseSpecifiers(match[1]));
  if (listed.some(specifiers => !specifiers)) return undefined;
  return [...new Set([...declared, ...listed.flatMap(specifiers => specifiers!.map(([, exported]) => exported))])];
}

/** Renames `file` and updates every relative specifier that resolves to it. `newSpecifier`, if given, replaces those specifiers outright. */
function renameFile(
  seed: Seed,
  file: string,
  newPath: string,
  newSource: string,
  newSpecifier?: string,
): Mutant | undefined {
  if (seed.files.has(newPath)) return undefined;
  const files: Files = new Map();
  const [oldBase, newBase] = [posix.basename(file), posix.basename(newPath)];
  let updatedCount = 0;
  for (const [path, source] of seed.files) {
    if (path === file) files.set(newPath, newSource);
    else
      files.set(
        path,
        isCodeFile(path)
          ? source.replace(/(["'])(\.[^"'\n]*)\1/g, (whole, quote, specifier) => {
              if (resolveSpecifier(seed, path, specifier) !== file || !specifier.endsWith(oldBase)) return whole;
              updatedCount++;
              return quote + (newSpecifier ?? specifier.slice(0, -oldBase.length) + newBase) + quote;
            })
          : source,
      );
  }
  return updatedCount ? { files } : undefined;
}

/** One site per code file that is neither the entry nor under node_modules. */
const forEachLocalModule = (
  seed: Seed,
  fileFilter: (file: string, source: string) => boolean,
  mutate: (file: string, source: string) => Mutant | undefined,
) =>
  [...seed.files]
    .filter(
      ([file, source]) =>
        file !== seed.entry && isCodeFile(file) && !file.includes("node_modules/") && fileFilter(file, source),
    )
    .map(
      ([file, source]) =>
        () =>
          mutate(file, source),
    );

// ---- Module graph mutations

const hasRelativeSpecifier = (match: SourceMatch) => match.captures[3].startsWith(".");
/** The path and the specifier of a new file next to the matched file, with the same extension. */
const siblingFile = (match: SourceMatch, baseName: string) => [
  folderOf(match.file) + baseName + extensionOf(match.file),
  "./" + baseName + extensionOf(match.file),
];

const moduleGraphMutations: Mutation[] = [
  {
    name: "add-star-reexport",
    findSites: forEachMatch(namedReexportPattern, isESModule, (seed, match) => {
      const [path, specifier] = siblingFile(match, "extra-module");
      return replaceRange(seed, match.file, match.end, match.end, `\nexport * from "${specifier}";`, [
        [path, "export const extraModule = 1;\n"],
      ]);
    }),
  },
  {
    name: "replace-named-reexport-with-star",
    findSites: forEachMatch(namedReexportPattern, isESModule, (seed, match) => {
      const specifiers = parseSpecifiers(match.captures[1]);
      return specifiers?.every(([imported, exported]) => imported === exported)
        ? replaceRange(seed, match.file, match.start, match.end, `export * from "${match.captures[3]}";`)
        : undefined;
    }),
  },
  {
    name: "replace-named-import-with-namespace",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const specifiers = parseSpecifiers(match.captures[1]);
      return (
        specifiers &&
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `import * as namespace from "${match.captures[3]}";\nconst ${toDestructuringPattern(specifiers)} = namespace;`,
        )
      );
    }),
  },
  {
    name: "print-namespace-keys",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const mutant = replaceRange(
        seed,
        match.file,
        match.end,
        match.end,
        `\nimport * as namespace from "${match.captures[3]}";`,
      );
      mutant?.files.set(
        match.file,
        mutant.files.get(match.file)!.replace(/\n?$/, "\nconsole.log(Object.keys(namespace).join());\n"),
      );
      return mutant;
    }),
  },
  {
    name: "set-side-effects-false",
    findSites: seed =>
      editPackageJson(seed, existing =>
        existing && "sideEffects" in existing ? undefined : { name: "app", ...existing, sideEffects: false },
      ),
  },
  {
    name: "set-side-effects-false-unnamed",
    findSites: seed => editPackageJson(seed, existing => (existing ? undefined : { sideEffects: false })),
  },
  {
    name: "set-side-effects-true",
    findSites: seed =>
      editPackageJson(seed, existing =>
        existing?.sideEffects === false ? { ...existing, sideEffects: true } : undefined,
      ),
  },
  {
    name: "set-package-type-module",
    findSites: seed =>
      editPackageJson(
        seed,
        existing => (existing && "type" in existing ? undefined : { ...existing, type: "module" }),
        true,
      ),
  },
  {
    name: "set-package-type-commonjs",
    findSites: seed =>
      editPackageJson(
        seed,
        existing => (existing && "type" in existing ? undefined : { ...existing, type: "commonjs" }),
        true,
      ),
  },
  {
    name: "import-through-named-barrel",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const specifiers = parseSpecifiers(match.captures[1]);
      const [path, specifier] = siblingFile(match, "extra-barrel");
      if (!specifiers || !hasRelativeSpecifier(match)) return undefined;
      const barrel = `export { ${[...new Set(specifiers.map(([imported]) => imported))].join(", ")} } from "${match.captures[3]}";\n`;
      return replaceRange(
        seed,
        match.file,
        match.start,
        match.end,
        match.captures[0].replace(match.captures[3], specifier),
        [[path, barrel]],
      );
    }),
  },
  {
    name: "import-through-star-barrel",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const [path, specifier] = siblingFile(match, "extra-barrel");
      if (!parseSpecifiers(match.captures[1]) || !hasRelativeSpecifier(match)) return undefined;
      return replaceRange(
        seed,
        match.file,
        match.start,
        match.end,
        match.captures[0].replace(match.captures[3], specifier),
        [[path, `export * from "${match.captures[3]}";\n`]],
      );
    }),
  },
  {
    name: "make-named-import-dynamic",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const specifiers = parseSpecifiers(match.captures[1]);
      return (
        specifiers &&
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `const ${toDestructuringPattern(specifiers)} = await import("${match.captures[3]}");`,
        )
      );
    }),
  },
  {
    name: "make-default-import-dynamic",
    findSites: forEachMatch(defaultImportPattern, isESModule, (seed, match) =>
      match.captures[1] === "type"
        ? undefined
        : replaceRange(
            seed,
            match.file,
            match.start,
            match.end,
            `const { default: ${match.captures[1]} } = await import("${match.captures[3]}");`,
          ),
    ),
  },
  {
    name: "make-namespace-import-dynamic",
    findSites: forEachMatch(namespaceImportPattern, isESModule, (seed, match) =>
      replaceRange(
        seed,
        match.file,
        match.start,
        match.end,
        `const ${match.captures[1]} = await import("${match.captures[3]}");`,
      ),
    ),
  },
  {
    name: "replace-named-import-with-require",
    findSites: forEachMatch(
      namedImportPattern,
      (file, source) => isESModule(file, source) && !isTypeScript(file),
      (seed, match) => {
        const specifiers = parseSpecifiers(match.captures[1]);
        return (
          specifiers &&
          replaceRange(
            seed,
            match.file,
            match.start,
            match.end,
            `const ${toDestructuringPattern(specifiers)} = require("${match.captures[3]}");`,
          )
        );
      },
    ),
  },
  {
    name: "prepend-side-effect-import",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) =>
      replaceRange(seed, match.file, match.start, match.start, `import "${match.captures[3]}";\n`),
    ),
  },
  {
    name: "add-import-cycle",
    findSites: forEachMatch(namedImportPattern, isESModule, (seed, match) => {
      const target = resolveSpecifier(seed, match.file, match.captures[3]);
      if (!target || !isESModule(target, seed.files.get(target)!)) return undefined;
      const importer = posix.relative(folderOf(target) || ".", match.file);
      return replaceRange(seed, target, 0, 0, `import "${importer.startsWith(".") ? importer : "./" + importer}";\n`);
    }),
  },
  {
    name: "add-star-reexport-cycle",
    findSites: forEachMatch(namedReexportPattern, isESModule, (seed, match) => {
      const target = resolveSpecifier(seed, match.file, match.captures[3]);
      if (!target || !isESModule(target, seed.files.get(target)!)) return undefined;
      const importer = posix.relative(folderOf(target) || ".", match.file);
      return replaceRange(
        seed,
        target,
        0,
        0,
        `export * from "${importer.startsWith(".") ? importer : "./" + importer}";\n`,
      );
    }),
  },
  {
    name: "convert-esm-to-commonjs",
    findSites: seed =>
      forEachLocalModule(seed, (file, source) => /\.mjs$/.test(file) && !!parseLeafModule(source), (file, source) => {
        const leaf = parseLeafModule(source)!;
        return renameFile(seed, file, file.replace(/\.mjs$/, ".cjs"), leaf.source.replace(/\n?$/, `\nmodule.exports = { ${leaf.names.join(", ")} };\n`));
      }), // prettier-ignore
  },
  {
    name: "convert-esm-to-commonjs-function",
    findSites: seed =>
      forEachLocalModule(seed, (file, source) => /\.mjs$/.test(file) && !!parseLeafModule(source), (file, source) => {
        const leaf = parseLeafModule(source)!;
        const assignments = leaf.names.map(name => `module.exports.${name} = ${name};`).join("\n");
        return renameFile(seed, file, file.replace(/\.mjs$/, ".cjs"), leaf.source.replace(/\n?$/, `\nmodule.exports = function () {};\n${assignments}\n`));
      }), // prettier-ignore
  },
  {
    name: "convert-commonjs-to-esm",
    findSites: seed =>
      forEachLocalModule(
        seed,
        (file, source) => {
          const names = [...source.matchAll(new RegExp(`^(?:module\\.)?exports\\.(${identifier}) = `, "gm"))].map(
            match => match[1],
          );
          return (
            /\.cjs$/.test(file) &&
            names.length > 0 &&
            new Set(names).size === names.length &&
            names.length === [...source.matchAll(/\bexports\b/g)].length &&
            !/\brequire\b|\b__filename\b|\b__dirname\b|\bthis\b|\bmodule\b(?!\.exports\.)|\barguments\b|^\s*return\b/m.test(
              source,
            ) &&
            !names.some(name =>
              new RegExp(`(?:const|let|var|function|class)\\s+${name.replace("$", "\\$")}\\b`).test(source),
            )
          );
        },
        (file, source) =>
          renameFile(
            seed,
            file,
            file.replace(/\.cjs$/, ".mjs"),
            source.replace(new RegExp(`^(?:module\\.)?exports\\.(${identifier}) = `, "gm"), "export const $1 = "),
          ),
      ),
  },
  {
    name: "replace-exports-object-with-function",
    findSites: forEachMatch(/^module\.exports = (\{[^{}]*\});?[ \t]*$/gm, isCommonJS, (seed, match) =>
      replaceRange(
        seed,
        match.file,
        match.start,
        match.end,
        `module.exports = function () {};\nObject.assign(module.exports, ${match.captures[1]});`,
      ),
    ),
  },
  {
    name: "assign-onto-module-exports",
    findSites: forEachMatch(/^module\.exports = (\{[^{}]*\});?[ \t]*$/gm, isCommonJS, (seed, match) =>
      replaceRange(seed, match.file, match.start, match.end, `Object.assign(module.exports, ${match.captures[1]});`),
    ),
  },
  {
    name: "add-commonjs-star-reexport",
    findSites: forEachMatch(namedReexportPattern, isESModule, (seed, match) =>
      replaceRange(seed, match.file, match.end, match.end, '\nexport * from "./extra-module.cjs";', [
        [folderOf(match.file) + "extra-module.cjs", "exports.extraModule = 1;\n"],
      ]),
    ),
  },
  {
    name: "replace-star-reexport-with-names",
    findSites: forEachMatch(createFromPattern("export\\s*\\*", 1), isESModule, (seed, match) => {
      const target = resolveSpecifier(seed, match.file, match.captures[2]);
      const names = target && collectExportedNames(seed.files.get(target)!);
      return names?.length
        ? replaceRange(
            seed,
            match.file,
            match.start,
            match.end,
            `export { ${names.join(", ")} } from "${match.captures[2]}";`,
          )
        : undefined;
    }),
  },
  {
    name: "import-namespace-through-barrel",
    findSites: forEachMatch(namespaceImportPattern, isESModule, (seed, match) => {
      const [path, specifier] = siblingFile(match, "extra-barrel");
      if (!hasRelativeSpecifier(match)) return undefined;
      return replaceRange(
        seed,
        match.file,
        match.start,
        match.end,
        `import { ${match.captures[1]} } from "${specifier}";`,
        [[path, `export * as ${match.captures[1]} from "${match.captures[3]}";\n`]],
      );
    }),
  },
  {
    name: "make-dynamic-import-static",
    findSites: forEachMatch(
      new RegExp(`^const (${identifier}) = await import\\((["'])([^"'\\n]+)\\2\\);?[ \\t]*$`, "gm"),
      isESModule,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `import * as ${match.captures[1]} from "${match.captures[3]}";`,
        ),
    ),
  },
  {
    name: "set-side-effects-empty-array",
    findSites: seed =>
      editPackageJson(seed, existing =>
        existing && "sideEffects" in existing ? undefined : { name: "app", ...existing, sideEffects: [] },
      ),
  },
  {
    name: "set-dependency-side-effects-false",
    findSites: seed =>
      [...seed.files]
        .filter(([file, json]) => /^node_modules\/[^/]+\/package\.json$/.test(file) && !json.includes('"sideEffects"'))
        .map(([file, json]) => () => ({
          files: new Map(seed.files).set(file, JSON.stringify({ ...JSON.parse(json), sideEffects: false }) + "\n"),
        })),
  },
  {
    name: "move-exports-onto-function",
    findSites: seed =>
      forEachLocalModule(
        seed,
        (file, source) =>
          isCommonJS(file, source) && /^exports\.[\w$]+ = /m.test(source) && !/\bmodule\.exports\b/.test(source),
        (file, source) => ({
          files: new Map(seed.files).set(
            file,
            "module.exports = function () {};\n" + source.replace(/\bexports\./g, "module.exports."),
          ),
        }),
      ),
  },
  {
    name: "move-module-into-package",
    findSites: seed =>
      forEachLocalModule(
        seed,
        (file, source) =>
          !/["']\.\.?\//.test(source) &&
          !/\b__filename\b|\b__dirname\b|\bimport\.meta\b/.test(source) &&
          !isTypeScript(file),
        (file, source) => {
          const main = "index" + extensionOf(file);
          const mutant = renameFile(seed, file, "node_modules/seed-package/" + main, source, "seed-package");
          mutant?.files.set(
            "node_modules/seed-package/package.json",
            JSON.stringify({ name: "seed-package", version: "1.0.0", main }) + "\n",
          );
          return mutant;
        },
      ),
  },
  {
    name: "rename-js-to-ts",
    findSites: seed =>
      [...seed.files]
        .filter(([file]) => /\.[cm]?js$/.test(file) && !file.includes("node_modules/"))
        .map(([file, source]) => () => {
          const newPath = file.replace(/js$/, "ts");
          if (file !== seed.entry) return renameFile(seed, file, newPath, source);
          const files = new Map([...seed.files].map(([path, content]) => [path === file ? newPath : path, content]));
          return files.size === seed.files.size ? { entry: newPath, files } : undefined;
        }),
  },
  {
    name: "wrap-entry-in-dynamic-import",
    findSites: seed => [
      () => ({
        entry: "wrapper-entry.mjs",
        files: new Map(seed.files).set("wrapper-entry.mjs", `await import("./${seed.entry}");\n`),
      }),
    ],
  },
  {
    name: "wrap-entry-in-static-import",
    findSites: seed => [
      () => ({
        entry: "wrapper-entry.mjs",
        files: new Map(seed.files).set("wrapper-entry.mjs", `import "./${seed.entry}";\n`),
      }),
    ],
  },
];

// ---- Loop mutations

/** Returns the index of the brace that closes the block opened at `open`, or -1. Skips strings, templates, comments and regular expressions. */
function findClosingBrace(source: string, open: number): number {
  let depth = 0;
  let previousChar = "";
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'") {
      for (index++; index < source.length && source[index] !== char; index++) {
        if (source[index] === "\\") index++;
        else if (source[index] === "\n") return -1;
      }
    } else if (char === "`") {
      for (index++; index < source.length && source[index] !== "`"; index++) {
        if (source[index] === "\\") index++;
        else if (source[index] === "$" && source[index + 1] === "{") {
          index = findClosingBrace(source, index + 1);
          if (index < 0) return -1;
        }
      }
    } else if (char === "/" && source[index + 1] === "/")
      index = source.indexOf("\n", index) < 0 ? source.length : source.indexOf("\n", index);
    else if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2) + 1;
      if (index < 1) return -1;
    } else if (char === "/" && (previousChar === "" || "(,=:[!&|?{};\n".includes(previousChar))) {
      let isInCharacterClass = false;
      for (index++; index < source.length && (isInCharacterClass || source[index] !== "/"); index++) {
        if (source[index] === "\\") index++;
        else if (source[index] === "[") isInCharacterClass = true;
        else if (source[index] === "]") isInCharacterClass = false;
        else if (source[index] === "\n") return -1;
      }
    } else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
    if (!/[ \t]/.test(source[index] ?? "")) previousChar = source[index] ?? "";
  }
  return -1;
}

// `for (keyword counter = init; counter operator bound; update)`. [start, end) is the header. [bodyStart, bodyEnd) is the body: a block, or one statement that ends its line.
// `body` is the source without the braces, and it starts at `innerStart`.
type CountedLoop = SourceMatch & {
  isAscending: boolean;
  keyword: string;
  counter: string;
  init: string;
  operator: string;
  bound: string;
  bodyStart: number;
  bodyEnd: number;
  innerStart: number;
  body: string;
};

const ascendingLoopPattern = new RegExp(
  `\\bfor \\((let|var) (${identifier}) = ([^;,\\n]+?); ?\\2 (<=?) ([^;\\n]+?); ?(?:\\2\\+\\+|\\+\\+\\2|\\2 \\+= 1)\\)`,
  "g",
);
const descendingLoopPattern = new RegExp(
  `\\bfor \\((let|var) (${identifier}) = ([^;,\\n]+?); ?\\2 (>=?) ([^;\\n]+?); ?(?:\\2--|--\\2|\\2 -= 1)\\)`,
  "g",
);
const escapeDollar = (name: string) => name.replace(/[$]/g, "\\$");
const isVariableOrNumber = (expression: string) => new RegExp(`^(?:${identifier}|-?\\d+)$`).test(expression);

function* findCountedLoops(seed: Seed, isAscending: boolean): Generator<CountedLoop> {
  for (const match of findMatches(seed, isAscending ? ascendingLoopPattern : descendingLoopPattern, () => true)) {
    const [, keyword, counter, init, operator, bound] = match.captures;
    if (/\(/.test(bound + init) || /[\w$]:\s*$/.test(match.source.slice(0, match.start))) continue;
    const bodyStart = match.end + /^[ \t]*\n?[ \t]*/.exec(match.source.slice(match.end))![0].length;
    let [bodyEnd, innerStart, body] = [0, 0, ""];
    if (match.source[bodyStart] === "{") {
      bodyEnd = findClosingBrace(match.source, bodyStart) + 1;
      if (!bodyEnd) continue;
      [innerStart, body] = [bodyStart + 1, match.source.slice(bodyStart + 1, bodyEnd - 1)];
    } else {
      const line = /^[^\n{}]*;[ \t]*(?=\n|$)/.exec(match.source.slice(bodyStart));
      if (!line || /^(?:for|while|do|if|switch|try)\b/.test(line[0])) continue;
      [bodyEnd, innerStart, body] = [bodyStart + line[0].length, bodyStart, line[0]];
    }
    // The body must not write the counter or anything else that the header reads.
    if (
      new RegExp(
        `(?:\\+\\+|--)\\s*${escapeDollar(counter)}\\b|\\b${escapeDollar(counter)}\\s*(?:\\+\\+|--|[-+*/%&|^]?=(?!=)|<<=|>>=|>>>=|\\*\\*=)`,
      ).test(body)
    )
      continue;
    const headerVariables = [...(bound + " " + init).matchAll(new RegExp(identifier, "g"))].map(found => found[0]);
    if (
      headerVariables.some(variable =>
        new RegExp(
          `\\b${escapeDollar(variable)}\\b\\s*(?:\\.\\s*(?:push|pop|shift|unshift|splice|length\\s*=|add|set|delete)\\b|\\[[^\\]]*\\]\\s*[-+*/]?=(?!=)|(?:\\+\\+|--|[-+*/%]?=(?!=)))`,
        ).test(body),
      )
    )
      continue;
    yield { ...match, isAscending, keyword, counter, init, operator, bound, bodyStart, bodyEnd, innerStart, body };
  }
}

/** One mutation for ascending loops and one, with the suffix `-descending`, for descending loops. */
const forBothDirections = (
  baseName: string,
  mutate: (seed: Seed, loop: CountedLoop) => Mutant | undefined,
  directions: boolean[] = [true, false],
): Mutation[] =>
  directions.map(isAscending => ({
    name: baseName + (isAscending || directions.length < 2 ? "" : "-descending"),
    findSites: seed => [...findCountedLoops(seed, isAscending)].map(loop => () => mutate(seed, loop)),
  }));
const parenthesize = (expression: string) =>
  new RegExp(`^${identifier}(?:\\.${identifier})*$|^\\d+$`).test(expression) ? expression : `(${expression})`;
const replaceHeader = (seed: Seed, loop: CountedLoop, replacement: string) =>
  replaceRange(seed, loop.file, loop.start, loop.end, replacement);
const replaceLoop = (seed: Seed, loop: CountedLoop, replacement: string) =>
  replaceRange(seed, loop.file, loop.start, loop.bodyEnd, replacement);
const headerOf = (loop: CountedLoop) => loop.source.slice(loop.start, loop.end);
const updateOf = (loop: CountedLoop) => loop.counter + (loop.isAscending ? "++" : "--");
const conditionOf = (loop: CountedLoop) => `${loop.counter} ${loop.operator} ${loop.bound}`;

/** Every `array[counter]` in the body of a counted loop: the stores if `isStore`, otherwise the reads. Yields the loop and the offset of the closing bracket. */
function* findElementAccesses(seed: Seed, isStore: boolean): Generator<[CountedLoop, number]> {
  for (const isAscending of [true, false])
    for (const loop of findCountedLoops(seed, isAscending))
      for (const match of loop.body.matchAll(
        new RegExp(
          `\\b(${identifier})(?:\\.${identifier})*\\[${escapeDollar(loop.counter)}\\](\\s*(?:[-+*/%|&^]?=(?!=)|\\+\\+|--))?`,
          "g",
        ),
      )) {
        // Two names may alias one array, so a store moves only if the bound is a variable or a number.
        if (!!match[2] !== isStore || (isStore && !isVariableOrNumber(loop.bound))) continue;
        yield [loop, loop.innerStart + match.index + match[0].length - (match[2]?.length ?? 0) - 1];
      }
}
const offsetElementIndex = (isStore: boolean, offset: string) => (seed: Seed) =>
  [...findElementAccesses(seed, isStore)].map(
    ([loop, bracket]) =>
      () =>
        replaceRange(seed, loop.file, bracket, bracket, offset),
  );

// `while (condition) {body}` and `do {body} while (condition);`. [start, end) is the whole loop. `body` is the source between the braces, and it starts at `innerStart`.
type WhileLoop = {
  file: string;
  source: string;
  isDoWhile: boolean;
  start: number;
  end: number;
  innerStart: number;
  body: string;
  condition: string;
};

function* findWhileLoops(seed: Seed): Generator<WhileLoop> {
  const conditionPattern = "((?:[^()\\n]|\\([^()\\n]*\\))+)";
  for (const match of findMatches(
    seed,
    new RegExp(`\\bwhile \\(${conditionPattern}\\) \\{|\\bdo \\{`, "g"),
    () => true,
  )) {
    const closingBrace = findClosingBrace(match.source, match.end - 1);
    if (closingBrace < 0 || /[\w$]:\s*$/.test(match.source.slice(0, match.start))) continue;
    const [innerStart, body] = [match.end, match.source.slice(match.end, closingBrace)];
    if (match.captures[1] !== undefined)
      yield {
        file: match.file,
        source: match.source,
        isDoWhile: false,
        start: match.start,
        end: closingBrace + 1,
        innerStart,
        body,
        condition: match.captures[1],
      };
    else {
      const tail = new RegExp(`^ while \\(${conditionPattern}\\);`).exec(match.source.slice(closingBrace + 1));
      if (tail)
        yield {
          file: match.file,
          source: match.source,
          isDoWhile: true,
          start: match.start,
          end: closingBrace + 1 + tail[0].length,
          innerStart,
          body,
          condition: tail[1],
        };
    }
  }
}
const forEachWhileLoop = (mutate: (seed: Seed, loop: WhileLoop) => Mutant | undefined) => (seed: Seed) =>
  [...findWhileLoops(seed)].map(loop => () => mutate(seed, loop));
const isSideEffectFree = (condition: string) => !/\+\+|--|[^=!<>]=(?!=)|\(/.test(condition);
const leadingVariable = (condition: string) =>
  new RegExp(`^(?:\\+\\+|--)?(${identifier})(?![\\w$]*[.[(])`).exec(condition)?.[1];

// `if (value > best) best = value;`, or the same with `<`.
const minMaxIfPattern = new RegExp(`\\bif \\(([^()\\n]+?) (>|<) (${identifier})\\) \\3 = \\1;`, "g");

const loopMutations: Mutation[] = [
  ...forBothDirections(
    "reverse-ascending-loop",
    (seed, loop) =>
      replaceHeader(
        seed,
        loop,
        `for (${loop.keyword} ${loop.counter} = ${loop.operator === "<" ? parenthesize(loop.bound) + " - 1" : loop.bound}; ${loop.counter} >= ${loop.init}; ${loop.counter}--)`,
      ),
    [true],
  ),
  ...forBothDirections(
    "reverse-descending-loop",
    (seed, loop) =>
      replaceHeader(
        seed,
        loop,
        `for (${loop.keyword} ${loop.counter} = ${loop.operator === ">" ? parenthesize(loop.bound) + " + 1" : loop.bound}, savedEnd = ${loop.init}; ${loop.counter} <= savedEnd; ${loop.counter}++)`,
      ),
    [false],
  ),
  { name: "store-at-next-index", findSites: offsetElementIndex(true, " + 1") },
  { name: "store-at-previous-index", findSites: offsetElementIndex(true, " - 1") },
  { name: "store-two-indexes-ahead", findSites: offsetElementIndex(true, " + 2") },
  { name: "read-at-next-index", findSites: offsetElementIndex(false, " + 1") },
  { name: "read-at-previous-index", findSites: offsetElementIndex(false, " - 1") },
  ...forBothDirections("toggle-inclusive-bound", (seed, loop) =>
    replaceHeader(
      seed,
      loop,
      headerOf(loop).replace(
        conditionOf(loop),
        `${loop.counter} ${loop.operator.length > 1 ? loop.operator[0] : loop.operator + "="} ${parenthesize(loop.bound)} ${loop.operator.length > 1 === loop.isAscending ? "+" : "-"} 1`,
      ),
    ),
  ),
  ...forBothDirections("cache-loop-bound", (seed, loop) =>
    /^-?\d+$/.test(loop.bound)
      ? undefined
      : replaceHeader(
          seed,
          loop,
          `for (${loop.keyword} ${loop.counter} = ${loop.init}, savedEnd = ${loop.bound}; ${loop.counter} ${loop.operator} savedEnd; ${updateOf(loop)})`,
        ),
  ),
  ...forBothDirections("swap-let-and-var", (seed, loop) =>
    replaceHeader(
      seed,
      loop,
      headerOf(loop).replace(/^for \((?:let|var) /, `for (${loop.keyword === "let" ? "var" : "let"} `),
    ),
  ),
  ...forBothDirections("step-by-two", (seed, loop) =>
    replaceHeader(
      seed,
      loop,
      `for (${loop.keyword} ${loop.counter} = ${loop.init}; ${conditionOf(loop)}; ${loop.counter} ${loop.isAscending ? "+" : "-"}= 2)`,
    ),
  ),
  ...forBothDirections("skip-first-iteration", (seed, loop) =>
    replaceHeader(
      seed,
      loop,
      `for (${loop.keyword} ${loop.counter} = ${parenthesize(loop.init)} ${loop.isAscending ? "+" : "-"} 1; ${conditionOf(loop)}; ${updateOf(loop)})`,
    ),
  ),
  ...forBothDirections("for-to-while", (seed, loop) =>
    /\bcontinue\b/.test(loop.body)
      ? undefined
      : replaceLoop(
          seed,
          loop,
          `{\n${loop.keyword} ${loop.counter} = ${loop.init};\nwhile (${conditionOf(loop)}) {\n${loop.body}\n${updateOf(loop)};\n}\n}`,
        ),
  ),
  ...forBothDirections("for-to-do-while", (seed, loop) =>
    /\bcontinue\b/.test(loop.body)
      ? undefined
      : replaceLoop(
          seed,
          loop,
          `{\n${loop.keyword} ${loop.counter} = ${loop.init};\nif (${conditionOf(loop)})\ndo {\n${loop.body}\n${updateOf(loop)};\n} while (${conditionOf(loop)});\n}`,
        ),
  ),
  ...forBothDirections("wrap-body-in-try", (seed, loop) =>
    replaceLoop(seed, loop, `${headerOf(loop)} {\ntry {\n${loop.body}\n} catch (error) {\nthrow error;\n}\n}`),
  ),
  ...forBothDirections("wrap-body-in-finally", (seed, loop) =>
    replaceLoop(seed, loop, `${headerOf(loop)} {\ntry {\n${loop.body}\n} finally {\nString(${loop.counter});\n}\n}`),
  ),
  ...forBothDirections("wrap-loop-in-try", (seed, loop) =>
    replaceLoop(seed, loop, `try {\n${headerOf(loop)} {\n${loop.body}\n}\n} catch (error) {\nthrow error;\n}`),
  ),
  ...forBothDirections("print-counter-after-loop", (seed, loop) =>
    replaceLoop(
      seed,
      loop,
      `{\n${loop.keyword} ${loop.counter} = ${loop.init};\nfor (; ${conditionOf(loop)}; ${updateOf(loop)}) {\n${loop.body}\n}\nconsole.log(String(${loop.counter}));\n}`,
    ),
  ),
  {
    name: "while-to-do-while",
    findSites: forEachWhileLoop((seed, loop) =>
      loop.isDoWhile || !isSideEffectFree(loop.condition)
        ? undefined
        : replaceRange(
            seed,
            loop.file,
            loop.start,
            loop.end,
            `if (${loop.condition})\ndo {${loop.body}} while (${loop.condition});`,
          ),
    ),
  },
  {
    name: "move-update-into-condition",
    findSites: forEachWhileLoop((seed, loop) => {
      const counter = leadingVariable(loop.condition);
      const trailingUpdate =
        counter && new RegExp(`(?:^|[;{}\\n])\\s*${escapeDollar(counter)}(\\+\\+|--);\\s*$`).exec(loop.body);
      if (!loop.isDoWhile || !trailingUpdate || !isSideEffectFree(loop.condition) || /\bcontinue\b/.test(loop.body))
        return undefined;
      const bodyWithoutUpdate = loop.body.slice(0, loop.body.lastIndexOf(counter + trailingUpdate[1]));
      return replaceRange(
        seed,
        loop.file,
        loop.start,
        loop.end,
        `do {${bodyWithoutUpdate}} while (${trailingUpdate[1]}${loop.condition});`,
      );
    }),
  },
  {
    name: "move-update-out-of-condition",
    findSites: forEachWhileLoop((seed, loop) => {
      const prefixUpdate = new RegExp(`^(\\+\\+|--)(${identifier})( .*)$`).exec(loop.condition);
      if (
        !loop.isDoWhile ||
        !prefixUpdate ||
        !isSideEffectFree(prefixUpdate[2] + prefixUpdate[3]) ||
        /\bcontinue\b/.test(loop.body)
      )
        return undefined;
      return replaceRange(
        seed,
        loop.file,
        loop.start,
        loop.end,
        `do {${loop.body}${prefixUpdate[2]}${prefixUpdate[1]};\n} while (${prefixUpdate[2]}${prefixUpdate[3]});`,
      );
    }),
  },
  {
    name: "print-condition-variable-after-loop",
    findSites: forEachWhileLoop((seed, loop) => {
      const counter = leadingVariable(loop.condition);
      return counter && replaceRange(seed, loop.file, loop.end, loop.end, `\nconsole.log(String(${counter}));`);
    }),
  },
  ...forBothDirections("record-accumulator-per-iteration", (seed, loop) => {
    const accumulator =
      new RegExp(minMaxIfPattern.source).exec(loop.body)?.[3] ??
      new RegExp(`\\b(${identifier}) = (?:Math\\.(?:max|min)\\(\\1, |[^;\\n]+ \\? [^;\\n]+ : \\1;)`).exec(
        loop.body,
      )?.[1];
    if (!accumulator || loop.body.includes("savedValue") || !/(?:^|[;{}])\s*$/.test(loop.source.slice(0, loop.start)))
      return undefined;
    return replaceLoop(
      seed,
      loop,
      `const savedValue = [];\n${headerOf(loop)} {\n${loop.body}\nsavedValue[${loop.counter}] = ${accumulator};\n}\nconsole.log(savedValue.join());`,
    );
  }),
  {
    name: "replace-math-max-with-if",
    findSites: forEachMatch(
      new RegExp(`\\b(${identifier}) = Math\\.(max|min)\\(\\1, ([^;()\\n]+)\\);`, "g"),
      () => true,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `if (${match.captures[3]} ${match.captures[2] === "max" ? ">" : "<"} ${match.captures[1]}) ${match.captures[1]} = ${match.captures[3]};`,
        ),
    ),
  },
  {
    name: "replace-if-with-math-max",
    findSites: forEachMatch(
      minMaxIfPattern,
      () => true,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `${match.captures[3]} = Math.${match.captures[2] === ">" ? "max" : "min"}(${match.captures[3]}, ${match.captures[1]});`,
        ),
    ),
  },
  {
    name: "replace-if-with-ternary",
    findSites: forEachMatch(
      minMaxIfPattern,
      () => true,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `${match.captures[3]} = ${match.captures[1]} ${match.captures[2]} ${match.captures[3]} ? ${match.captures[1]} : ${match.captures[3]};`,
        ),
    ),
  },
  {
    name: "widen-array-type-to-any",
    findSites: forEachMatch(/: (?:number|string)\[\](?=[,)= ;])/g, isTypeScript, (seed, match) =>
      replaceRange(seed, match.file, match.start, match.end, ": any"),
    ),
  },
  {
    name: "replace-array-literal-with-json",
    findSites: forEachMatch(
      /\[(-?\d+(?:\.\d+)?(?:, -?\d+(?:\.\d+)?)+)\](?!\s*(?:=(?!=)|\]))/g,
      () => true,
      (seed, match) =>
        /["'`]/.test(
          match.source
            .slice(match.source.lastIndexOf("\n", match.start) + 1, match.start)
            .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ""),
        )
          ? undefined
          : replaceRange(
              seed,
              match.file,
              match.start,
              match.end,
              `JSON.parse("[${match.captures[1].replaceAll(" ", "")}]")`,
            ),
    ),
  },
  ...(
    [
      ["array-from", (array: string) => `Array.from(${array})`],
      ["slice", (array: string) => `${array}.slice()`],
      ["spread", (array: string) => `[...${array}]`],
      ["map", (array: string) => `${array}.map(value => value)`],
    ] as [string, (array: string) => string][]
  ).map(
    ([method, copy]): Mutation => ({
      name: "copy-json-with-" + method,
      findSites: forEachMatch(
        /(?<![\w$.(]\(|\.\.\.)JSON\.parse\((["'])\[[^"'\n]*\]\1\)(?!\s*[.[])/g,
        () => true,
        (seed, match) => replaceRange(seed, match.file, match.start, match.end, copy(match.captures[0])),
      ),
    }),
  ),
  ...(
    [
      ["array-from", (array: string) => `Array.from(${array})`],
      ["slice", (array: string) => `${array}.slice()`],
      ["spread", (array: string) => `[...${array}]`],
    ] as [string, (array: string) => string][]
  ).map(
    ([method, copy]): Mutation => ({
      name: "copy-parameter-with-" + method,
      findSites: forEachMatch(
        new RegExp(`\\bfunction\\*? ${identifier}\\((${identifier})(?:: [^,)\\n]+)?[,)][^\\n]*\\{$`, "gm"),
        () => true,
        (seed, match) =>
          new RegExp(`\\b${escapeDollar(match.captures[1])}\\[`).test(match.source.slice(match.end, match.end + 600))
            ? replaceRange(
                seed,
                match.file,
                match.end,
                match.end,
                `\n${match.captures[1]} = ${copy(match.captures[1])};`,
              )
            : undefined,
      ),
    }),
  ),
  {
    name: "replace-empty-array-with-json",
    findSites: forEachMatch(
      / = \[\];/g,
      () => true,
      (seed, match) => replaceRange(seed, match.file, match.start, match.end, ' = JSON.parse("[]");'),
    ),
  },
  {
    name: "presize-empty-array",
    findSites: forEachMatch(
      / = \[\];/g,
      () => true,
      (seed, match) => replaceRange(seed, match.file, match.start, match.end, " = new Array(3);"),
    ),
  },
];

// ---- Object mutations

// `const name = initializer;` on its own line, with a read of `name.property` further down. `afterLastUse` is the end of the last line of the same block that mentions `name`.
type ObjectBinding = {
  file: string;
  source: string;
  start: number;
  end: number;
  indent: string;
  name: string;
  initializer: string;
  property: string;
  afterLastUse: number;
};

function* findObjectBindings(seed: Seed): Generator<ObjectBinding> {
  for (const match of findMatches(
    seed,
    new RegExp(`^( *)(?:const|let) (${identifier})(?:: [^=\\n]+)? = ([^;\\n]+);$`, "gm"),
    () => true,
  )) {
    const [, indent, name, initializer] = match.captures;
    const followingLines = match.source.slice(match.end + 1).split("\n");
    // The block continues while the lines are indented at least as deep.
    let [offset, afterLastUse, property] = [match.end + 1, -1, ""];
    for (const line of followingLines) {
      if (line.trim() && !line.startsWith(indent)) break;
      if (line.startsWith(indent) && line[indent.length] === "}") break;
      const propertyRead = new RegExp(`\\b${escapeDollar(name)}\\.(${identifier})\\b(?!\\s*[(=])`).exec(line);
      if (propertyRead && !property) property = propertyRead[1];
      if (
        new RegExp(`\\b${escapeDollar(name)}\\b`).test(line) &&
        line.startsWith(indent) &&
        line[indent.length] !== " " &&
        /;$/.test(line) &&
        !/^\s*return\b/.test(line)
      )
        afterLastUse = offset + line.length;
      offset += line.length + 1;
    }
    if (property && property !== "length" && afterLastUse > 0 && /^[\w$.]+\(|^\{|^new /.test(initializer))
      yield {
        file: match.file,
        source: match.source,
        start: match.start,
        end: match.end,
        indent,
        name,
        initializer,
        property,
        afterLastUse,
      };
  }
}
const insertAfterLastUse = (mutationName: string, emit: (binding: ObjectBinding) => string): Mutation => ({
  name: mutationName,
  findSites: seed =>
    [...findObjectBindings(seed)].map(
      binding => () =>
        replaceRange(
          seed,
          binding.file,
          binding.afterLastUse,
          binding.afterLastUse,
          "\n" + binding.indent + emit(binding),
        ),
    ),
});
const replaceInitializer = (mutationName: string, emit: (binding: ObjectBinding) => string): Mutation => ({
  name: mutationName,
  findSites: seed =>
    [...findObjectBindings(seed)].map(binding => () => {
      const initializerStart = binding.end - 1 - binding.initializer.length;
      return replaceRange(seed, binding.file, initializerStart, binding.end - 1, emit(binding));
    }),
});
// `{ a: 1, b: two }`: identifier keys, and values without a comma, a brace, a bracket or a parenthesis.
const flatObjectLiteralPattern = new RegExp(
  `\\{ ((?:${identifier}: [^,{}()\\[\\]\\n]+, )+${identifier}: [^,{}()\\[\\]\\n]+) \\}`,
  "g",
);

const objectMutations: Mutation[] = [
  insertAfterLastUse(
    "make-property-read-only",
    binding => `Object.defineProperty(${binding.name}, "${binding.property}", { writable: false });`,
  ),
  insertAfterLastUse(
    "make-property-non-enumerable",
    binding => `Object.defineProperty(${binding.name}, "${binding.property}", { enumerable: false });`,
  ),
  insertAfterLastUse(
    "define-property-with-empty-descriptor",
    binding => `Object.defineProperty(${binding.name}, "${binding.property}", {});`,
  ),
  insertAfterLastUse(
    "redefine-property-with-same-value",
    binding =>
      `Object.defineProperty(${binding.name}, "${binding.property}", { value: ${binding.name}.${binding.property} });`,
  ),
  insertAfterLastUse("delete-property", binding =>
    `delete (${binding.name} as any).${binding.property};`
      .replace(" as any", isTypeScript(binding.file) ? " as any" : "")
      .replace(/^delete \((\w+)\)/, "delete $1"),
  ),
  insertAfterLastUse("add-property", binding =>
    isTypeScript(binding.file) ? `(${binding.name} as any).extraProperty = 1;` : `${binding.name}.extraProperty = 1;`,
  ),
  insertAfterLastUse("freeze-object", binding => `Object.freeze(${binding.name});`),
  insertAfterLastUse("print-object-as-json", binding => `console.log(JSON.stringify(${binding.name}));`),
  insertAfterLastUse("print-object-keys", binding => `console.log(Object.keys(${binding.name}).join());`),
  replaceInitializer("copy-object-with-spread", binding => `{ ...${binding.initializer} }`),
  replaceInitializer("copy-object-through-json", binding => `JSON.parse(JSON.stringify(${binding.initializer}))`),
  replaceInitializer("copy-object-with-assign", binding => `Object.assign({}, ${binding.initializer})`),
  {
    name: "reverse-property-order",
    findSites: forEachMatch(
      flatObjectLiteralPattern,
      () => true,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          `{ ${match.captures[1].split(", ").reverse().join(", ")} }`,
        ),
    ),
  },
  {
    name: "make-first-property-computed",
    findSites: forEachMatch(
      flatObjectLiteralPattern,
      file => !isTypeScript(file),
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          match.captures[0].replace(new RegExp(`^\\{ (${identifier}):`), '{ ["$1"]:'),
        ),
    ),
  },
  {
    name: "make-first-property-getter",
    findSites: forEachMatch(
      flatObjectLiteralPattern,
      () => true,
      (seed, match) =>
        replaceRange(
          seed,
          match.file,
          match.start,
          match.end,
          match.captures[0].replace(new RegExp(`^\\{ (${identifier}): ([^,]+),`), "{ get $1() { return $2; },"),
        ),
    ),
  },
  {
    name: "make-property-optional",
    findSites: forEachMatch(new RegExp(`^( +)(${identifier}): (?=[^;\\n]+;$)`, "gm"), isTypeScript, (seed, match) =>
      /\b(?:interface|type) [^\n]*\{\n(?: +[^\n]*\n)*$/.test(match.source.slice(0, match.start))
        ? replaceRange(seed, match.file, match.start, match.end, `${match.captures[1]}${match.captures[2]}?: `)
        : undefined,
    ),
  },
  {
    name: "add-empty-partial-object",
    findSites: forEachMatch(
      new RegExp(`^(?:export )?interface (${identifier}) \\{$`, "gm"),
      isTypeScript,
      (seed, match) => {
        const closingBrace = findClosingBrace(match.source, match.end - 1);
        return closingBrace < 0
          ? undefined
          : replaceRange(
              seed,
              match.file,
              closingBrace + 1,
              closingBrace + 1,
              `\nconst draftObject: Partial<${match.captures[1]}> = {};\nconsole.log(Object.keys(draftObject).length);`,
            );
      },
    ),
  },
];

const identityMutations: Mutation[] = [
  // Emits the seed as it is. If the unchanged seed already differs from plain Bun, the results of its other mutants are ignored.
  { name: "unchanged-seed", findSites: seed => [() => ({ files: seed.files })] },
];

// ---- Mutant numbering

const matchesName = (pattern: string | undefined) => (mutation: Mutation) =>
  !pattern || new RegExp(pattern).test(mutation.name);
const allMutations = [...moduleGraphMutations, ...loopMutations, ...objectMutations, ...identityMutations];
const mutations = allMutations.filter(matchesName(process.env.MUTATIONS));
const requiredMutations = process.env.SEED_FILTER ? allMutations.filter(matchesName(process.env.SEED_FILTER)) : [];
const seeds = seedRoots
  .flatMap(root => [...readSeeds(root, "")])
  .filter(
    seed =>
      !requiredMutations.length || requiredMutations.some(mutation => mutation.findSites(seed).some(site => site())),
  );
// For each mutation, for each seed: the number of the first mutant.
const firstIndexes: number[][] = [];
let total = 0;
for (const mutation of mutations) {
  const indexes: number[] = [];
  for (const seed of seeds) {
    indexes.push(total);
    total += mutation.findSites(seed).length;
  }
  firstIndexes.push(indexes);
}

function locate(index: number) {
  let mutationIndex = mutations.length - 1;
  while (firstIndexes[mutationIndex][0] > index) mutationIndex--;
  const indexes = firstIndexes[mutationIndex];
  let [low, high] = [0, indexes.length - 1];
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (indexes[middle] <= index) low = middle;
    else high = middle - 1;
  }
  return { mutation: mutations[mutationIndex], seed: seeds[low], site: index - indexes[low] };
}

const truncate = (name: string, maxLength: number) =>
  name.length <= maxLength ? name : name.slice(0, maxLength - 1) + "~";
function nameMutant(index: number) {
  const { mutation, seed, site } = locate(index);
  const [group, ...rest] = seed.path.replace(/\.[^./]+$/, "").split("/");
  return `${mutation.name}--${site}--${truncate(group, 50)}--${truncate(rest.join("+") || "main", 70)}`;
}

/** Returns undefined if the mutation turns out not to apply. The site keeps its number, so `count` does not have to run the mutations. */
function write(index: number): { name: string; text: string } | undefined {
  const { mutation, seed, site } = locate(index);
  const mutant = mutation.findSites(seed)[site]();
  if (!mutant) return undefined;
  const entry = mutant.entry ?? (mutant.files.has(seed.entry) ? seed.entry : undefined);
  if (!entry) return undefined;
  const parts = [`// @entry: ./${entry}`, mutant.files.get(entry)!.replace(/\n$/, "")];
  for (const [path, source] of mutant.files)
    if (path !== entry) parts.push(`// @filename: ./${path}`, source.replace(/\n$/, ""));
  return { name: nameMutant(index) + /\.[^.]+$/.exec(entry)![0], text: parts.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else if (process.argv[2] === "mutations") {
  console.log(`${seeds.length} seed programs`);
  mutations.forEach((mutation, position) =>
    console.log(
      `${firstIndexes[position][0]}\t${(firstIndexes[position + 1]?.[0] ?? total) - firstIndexes[position][0]}\t${mutation.name}`,
    ),
  );
} else if (process.argv[2] === "where") {
  const { mutation, seed, site } = locate(Number(process.argv[3]));
  console.log(`${seed.path}\t${mutation.name}\t${site}`);
} else if (process.argv[2] === "named") {
  const [pattern, folder, limit] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let index = 0; index < total && written < limit; index++) {
    if (!pattern.test(nameMutant(index))) continue;
    const program = write(index);
    if (!program) continue;
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    if (!program) continue;
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
}

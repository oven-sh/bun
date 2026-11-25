// Generates random programs that load a package in node_modules through barrels: files of the application that re-export names of it, whether another file reads them or not.
// The package has barrels of its own: `export *` of a file that has `export *` itself, names, renamed names, namespaces, defaults, ES modules beside CommonJS files.
// The application loads its first barrel by `import`, by `import()` or by `require` of an ES module. Either package may say that it has no side effects; then no file has any.
// Each program prints the names that it gets and what they hold. The program number is the random seed.
//
//   bun write-random-barrel-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<files>-files--<load>--<side effects>.mjs
//   bun write-random-barrel-sweep.ts count
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

const total = 8_000_000;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  const below = (end: number) => Math.floor(next() * end);
  return { below, chance: (of: number) => next() < of, pick: <T>(from: readonly T[]): T => from[below(from.length)] };
}

const loads = [
  "import",
  "import-namespace",
  "dynamic-import",
  "require-from-commonjs",
  "require-from-commonjs-in-try",
] as const;
const sideEffectFlags = ["none", "package", "application", "both"] as const;

const builtinNames = [
  ["inspect", "node:util"],
  ["inspect", "node:util"],
  ["types", "node:util"],
  ["promises", "node:fs"],
  ["promises", "node:timers"],
  ["sep", "node:path"],
  ["posix", "node:path"],
  ["EOL", "node:os"],
  ["builtinModules", "node:module"],
] as const;

/** A file that the generator has written, with the names that others can import from it. */
interface File {
  path: string;
  isCommonJS: boolean;
  names: string[];
  hasDefault: boolean;
  lines: string[];
}

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed);
  const load = random.pick(loads);
  const sideEffects = random.pick(sideEffectFlags);
  const isSilent = sideEffects !== "none";
  let nameCount = 0;
  const value = (text: string) =>
    random.pick([`"${text}"`, `String(process.env.NOT_SET ?? "${text}")`, `(() => "${text}")()`, `["${text}"].join()`]);

  const createLeaf = (path: string, isCommonJS: boolean): File => {
    const names = Array.from({ length: 1 + random.below(3) }, () => "name" + nameCount++);
    const hasDefault = random.chance(0.3);
    const lines: string[] = [];
    if (isCommonJS) {
      if (hasDefault) lines.push('Object.defineProperty(exports, "__esModule", { value: true });');
      for (const name of names)
        lines.push(
          random.pick([
            `exports.${name} = ${value(name)};`,
            `module.exports.${name} = ${value(name)};`,
            `Object.defineProperty(exports, "${name}", { enumerable: true, get: () => ${value(name)} });`,
          ]),
        );
      if (hasDefault) lines.push(`exports.default = ${value("default of " + path)};`);
    } else {
      for (const name of names)
        lines.push(
          random.pick([
            `export const ${name} = ${value(name)};`,
            `export let ${name} = ${value(name)};`,
            `export function ${name}() {\n  return ${value(name)};\n}`,
            `export class ${name} {\n  static text = ${value(name)};\n}`,
            `const local_${name} = ${value(name)};\nexport { local_${name} as ${name} };`,
          ]),
        );
      if (hasDefault) lines.push(`export default ${value("default of " + path)};`);
    }
    return { path, isCommonJS, names, hasDefault, lines };
  };

  /** An import of a file, as the text of its specifier in another file. */
  let packageEntry = "";
  const specifier = (from: string, to: string): string => {
    const inPackage = (path: string) => path.startsWith("node_modules/kit/");
    if (!inPackage(from) && inPackage(to))
      return to === packageEntry && random.chance(0.5) ? "kit" : to.slice("node_modules/".length);
    return "./" + to.slice(to.lastIndexOf("/") + 1);
  };

  /** A file that re-exports from others, and may have names of its own. */
  const createBarrel = (path: string, targets: File[]): File => {
    const names: string[] = [];
    const lines: string[] = [];
    let hasDefault = false;
    const add = (name: string) => {
      if (names.includes(name)) return false;
      names.push(name);
      return true;
    };
    for (const target of targets) {
      const from = `"${specifier(path, target.path)}"`;
      switch (random.below(7)) {
        case 0:
        case 1:
        case 2:
          if (target.names.some(name => names.includes(name))) break;
          for (const name of target.names) add(name);
          lines.push(`export * from ${from};`);
          break;
        case 3: {
          const name = random.pick(target.names);
          if (add(name)) lines.push(`export { ${name} } from ${from};`);
          break;
        }
        case 4: {
          const name = "renamed" + nameCount++;
          if (add(name)) lines.push(`export { ${random.pick(target.names)} as ${name} } from ${from};`);
          break;
        }
        case 5: {
          const name = "namespace" + nameCount++;
          if (add(name)) lines.push(`export * as ${name} from ${from};`);
          break;
        }
        default: {
          const name = random.pick(target.names);
          const local = "imported" + nameCount++;
          if (add(name)) lines.push(`import { ${name} as ${local} } from ${from};`, `export { ${local} as ${name} };`);
          break;
        }
      }
      if (target.hasDefault && !hasDefault && random.chance(0.2)) {
        hasDefault = true;
        lines.push(`export { default } from ${from};`);
      }
    }
    // A name of a built-in module.
    if (random.chance(0.2)) {
      const [builtin, from] = random.pick(builtinNames);
      const name = "builtin" + nameCount++;
      names.push(name);
      lines.push(
        random.chance(0.8)
          ? `export { ${builtin} as ${name} } from "${from}";`
          : `import { ${builtin} as local${nameCount} } from "${from}";\nexport { local${nameCount++} as ${name} };`,
      );
    }
    if (names.length === 0 || random.chance(0.6)) {
      const name = "own" + nameCount++;
      names.push(name);
      lines.push(`export const ${name} = ${value(name)};`);
    }
    return { path, isCommonJS: false, names, hasDefault, lines };
  };

  // The package, from its leaves to its entry.
  const files: File[] = [];
  const leafCount = 2 + random.below(3);
  for (let index = 0; index < leafCount; index++) {
    const isCommonJS = random.chance(0.4);
    files.push(createLeaf(`node_modules/kit/leaf${index}.${isCommonJS ? "cjs" : "js"}`, isCommonJS));
  }
  let top = files.slice();
  const barrelCount = 1 + random.below(3);
  for (let index = barrelCount - 1; index >= 0; index--) {
    const targets = index === barrelCount - 1 ? top : [top[0], ...top.slice(1).filter(() => random.chance(0.3))];
    const barrel = createBarrel(`node_modules/kit/barrel${index}.js`, targets);
    files.push(barrel);
    top = [barrel, ...files.filter(file => file !== barrel && random.chance(0.15))];
  }
  packageEntry = top[0].path;

  // The application's barrels, from the package to the first file that is loaded.
  let target = top[0];
  const applicationCount = 1 + random.below(3);
  const applicationFiles: File[] = [];
  for (let index = applicationCount - 1; index >= 0; index--) {
    const others = applicationFiles.filter(file => file !== target && random.chance(0.3));
    const barrel = createBarrel(`theme${index}.mjs`, [target, ...others]);
    applicationFiles.push(barrel);
    target = barrel;
  }
  const page: File = { path: "page.mjs", isCommonJS: false, names: ["title"], hasDefault: false, lines: [] };
  const read = target.names.filter(() => random.chance(0.4)).slice(0, 3);
  const pageFrom = `"./${target.path}"`;
  switch (random.below(4)) {
    case 0:
      page.lines.push(`import * as all from ${pageFrom};`, "export const title = Object.keys(all).sort().join();");
      break;
    case 1:
      page.lines.push(`import { ${random.pick(target.names)} } from ${pageFrom};`, 'export const title = "unused";');
      break;
    case 2:
      page.lines.push(`export * from ${pageFrom};`, 'export const title = "home";');
      page.names.push(...target.names);
      break;
    default:
      page.lines.push(
        read.length ? `import { ${read.join(", ")} } from ${pageFrom};` : `import ${pageFrom};`,
        `export const title = [${read.map(name => `describe(${name})`).join(", ")}].join();`,
        "function describe(value) {",
        '  return typeof value === "string" ? value : typeof value === "function" ? (value.text ?? value()) : Object.keys(value).sort().join("+");',
        "}",
      );
  }

  const main: string[] = [];
  const extra: string[] = [];
  const describe =
    'const describe = value => typeof value === "string" ? value : typeof value === "function" ? (value.text ?? value()) : value === undefined ? "undefined" : Object.keys(value).sort().join("+");';
  const showNamespace = (namespace: string) =>
    `console.log(Object.keys(${namespace}).sort().map(key => key + "=" + describe(${namespace}[key])).join(" "));`;
  switch (load) {
    case "import":
      main.push(`import { title } from "./page.mjs";`, 'console.log("title", title);');
      break;
    case "import-namespace":
      main.push(`import * as page from "./page.mjs";`, describe, showNamespace("page"));
      break;
    case "dynamic-import":
      main.push(describe, `const page = await import("./page.mjs");`, showNamespace("page"));
      break;
    default: {
      const body =
        load === "require-from-commonjs"
          ? ['const page = require("./page.mjs");']
          : [
              "let page = {};",
              "try {",
              '  page = require("./page.mjs");',
              "} catch (error) {",
              "  page = { threw: error.name };",
              "}",
            ];
      main.push('import listed from "./loader.cjs";', 'console.log("end", listed);');
      extra.push(
        "// @filename: ./loader.cjs",
        describe,
        ...body,
        'module.exports = Object.keys(page).sort().map(key => key + "=" + describe(page[key])).join(" ");',
      );
    }
  }
  const all = [page, ...applicationFiles, ...files];
  // In which order `bun <file>` evaluates CommonJS files that ES modules import is a matter of time.
  if (!isSilent)
    for (const file of all)
      if (!file.isCommonJS && random.chance(0.4)) file.lines.push(`console.log("loads ${file.path}");`);
  // Another file of the application may read the package too.
  if (random.chance(0.3)) {
    const name = random.pick(top[0].names);
    extra.push(
      "// @filename: ./other.mjs",
      `import { ${name} } from "kit";`,
      `export const otherKind = typeof ${name};`,
    );
    main.unshift('import { otherKind } from "./other.mjs";');
    main.push('console.log("other", otherKind);');
  }
  const flag = (owner: "application" | "package") =>
    sideEffects === owner || sideEffects === "both" ? ', "sideEffects": false' : "";
  const text = [
    "// @entry: ./main.mjs",
    ...main,
    ...extra,
    ...all.flatMap(file => [`// @filename: ./${file.path}`, ...file.lines]),
    "// @filename: ./package.json",
    `{ "name": "app", "version": "1.0.0"${flag("application")} }`,
    "// @filename: ./node_modules/kit/package.json",
    `{ "name": "kit", "version": "1.0.0", "main": "./${packageEntry.slice("node_modules/kit/".length)}", "type": "module"${flag("package")} }`,
  ];
  return { name: `${all.length}-files--${load}--${sideEffects}.mjs`, text: text.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(
      `${folder}/${padNumber(index)}-${program.name}`,
      printThroughBranch(program.text, index, program.name),
    );
  }
  console.log(Math.min(count, total));
}

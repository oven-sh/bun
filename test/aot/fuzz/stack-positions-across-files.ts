// Writes a program of several files out of the code of stack-positions-in-ordinary-code.ts: ES modules, CommonJS files and TypeScript, which export what
// they declare in every way and take it from each other in every way, directly or through a file that exports it again. Some files call while they are
// loaded. `step()` lives in a file of its own and throws at the call whose number the program asks for; the program prints the function, file, line and
// column of every frame.
import type { Random } from "./random";
import {
  constructorFunction,
  helperNames,
  write,
  type Callable,
  type Exported,
  type Part,
  type Shape,
} from "./stack-positions-in-ordinary-code";

type Kind = "module" | "commonjs" | "typescript";

// `member` is read from what the file exports under `exportedAs`.
type Offered = Exported & { member?: string };

interface File {
  path: string;
  kind: Kind;
  offers: Offered[];
  // It waits at its top level, or something that it imports does: `require()` refuses it.
  awaits: boolean;
}

// `hasMore` adds packages in node_modules, functions that return what `require()` answers, and default exports without a name.
export function generate(
  random: Random,
  hasMore = false,
): { file: string; text: string; files: Record<string, string> } {
  const counters = { names: 0, literals: 0 };
  const fresh = (stem: string) => `${stem}${++counters.names}`;
  const isBroad = random.chance(0.5);
  const flavor = random.weighted<"modules" | "commonjs" | "both">([
    [3, "modules"],
    [2, "commonjs"],
    [5, "both"],
  ]);
  const hasTyped = flavor !== "commonjs" && random.chance(0.5);
  const texts: Record<string, string> = {};

  const drawKind = (): Kind =>
    random.weighted<Kind>([
      [hasTyped ? 5 : 0, "typescript"],
      [flavor === "commonjs" ? 0 : 3, "module"],
      [flavor === "modules" ? 0 : 3, "commonjs"],
    ]);
  const mainKind = drawKind();
  // While the files that an ES module imports are being loaded, `require()` may refuse one of them.
  const mayRequireModules = (role: Part["role"]) => mainKind === "commonjs" || role === "loaded" || role === "main";
  const extensionOf = (kind: Kind) =>
    kind === "typescript"
      ? random.pick([".ts", ".ts", ".ts", ".mts"])
      : kind === "module"
        ? random.pick([".mjs", ".mjs", ".js"])
        : random.pick([".cjs", ".cjs", ".js"]);
  // TypeScript finds a file without its extension only if that is `.ts` or `.js`, also in a JavaScript file through which a TypeScript file imports a name.
  const specifier = (from: string, to: string) => {
    const inPackage = /^node_modules\/(\w+)\//.exec(to);
    if (inPackage) return JSON.stringify(inPackage[1]);
    const path = from.startsWith("lib/")
      ? "./" + to.slice("lib/".length)
      : from.startsWith("node_modules/")
        ? "../../" + to
        : "./" + to;
    const mayBeShort = !/ts$/.test(from) || /\.[jt]s$/.test(to);
    const isShort = mayBeShort && random.chance(0.25) && (!hasTyped || /\.[jt]s$/.test(to));
    return JSON.stringify(isShort ? path.replace(/\.\w+$/, "") : path);
  };

  const helpers: File = {
    kind: hasTyped ? "typescript" : flavor === "modules" ? "module" : "commonjs",
    path: "",
    offers: [],
    awaits: false,
  };
  helpers.path = "lib/helpers" + (hasTyped ? ".ts" : extensionOf(helpers.kind));
  const empty = { counters, functions: [], shapes: [], mayAwait: false, loads: "", mayOmitNames: hasMore };
  texts[helpers.path] = write(random, {
    isTyped: hasTyped,
    isCommonJs: helpers.kind === "commonjs",
    isBroad,
    part: { ...empty, role: "helpers", heading: "" },
  }).text;

  const takeNames = (kind: Kind, names: string[], from: string) =>
    kind === "commonjs"
      ? `const { ${names.join(", ")} } = require(${from});\n`
      : `import { ${names.join(", ")} } from ${from};\n`;

  const legacy: File = {
    kind: helpers.kind === "commonjs" ? "commonjs" : "module",
    path: "",
    offers: [],
    awaits: false,
  };
  legacy.path = "lib/legacy" + extensionOf(legacy.kind);
  if (isBroad)
    texts[legacy.path] =
      takeNames(legacy.kind, ["step"], specifier(legacy.path, helpers.path)) +
      constructorFunction +
      (legacy.kind === "commonjs" ? "exports.Legacy = Legacy;\n" : "export { Legacy };\n");

  // The lines with which a file takes `wanted` from another, and how it writes each of them from then on.
  function take(path: string, kind: Kind, mayAwait: boolean, from: File, wanted: Offered[], locals: Set<string>) {
    const lines: string[] = [];
    const functions: Callable[] = [];
    const shapes: Shape[] = [];
    const source = specifier(path, from.path);
    const isTypeKnown = kind === "typescript" && from.kind === "typescript";
    // A typed file takes what an untyped file exports as `any`.
    const isLoose = kind === "typescript" && from.kind !== "typescript";
    const any = isLoose ? ": any" : "";
    const loosened = (local: string) => {
      if (!isLoose) return local;
      const name = fresh("loose");
      lines.push(`const ${name}: any = ${local};`);
      return name;
    };
    const add = (offered: Offered, base: string, isType: boolean, isAwaited = false) => {
      const name = offered.member ? `${base}.${offered.member}` : base;
      if (offered.callable) functions.push({ ...offered.callable, name, isAwaited });
      if (offered.shape)
        shapes.push({
          ...offered.shape,
          name,
          typeName: isTypeKnown && isType ? name : null,
          isAny: isLoose || offered.shape.isAny,
        });
    };
    const member = (holder: string, offered: Offered) => `${holder}.${offered.exportedAs}`;
    const localOf = (offered: Offered) => {
      const local =
        offered.exportedAs === "default" || locals.has(offered.exportedAs) || random.chance(0.2)
          ? fresh(offered.shape && !offered.member ? "Taken" : "taken")
          : offered.exportedAs;
      locals.add(local);
      return local;
    };
    // One name may stand for several things that are read from it.
    const byName = [...Map.groupBy(wanted, offered => offered.exportedAs).values()];
    const destructured = (separator: string) =>
      byName.map(group => {
        const local = localOf(group[0]);
        return { group, local, text: local === group[0].exportedAs ? local : group[0].exportedAs + separator + local };
      });
    const required = (requireName: string) =>
      random.pick<() => void>([
        () => {
          const names = destructured(": ");
          lines.push(`const { ${names.map(name => name.text).join(", ")} } = ${requireName}(${source});`);
          for (const { group, local } of names) for (const offered of group) add(offered, local, false);
        },
        () => {
          const holder = fresh("library");
          lines.push(`const ${holder} = ${requireName}(${source});`);
          for (const offered of wanted) add(offered, member(holder, offered), false);
        },
        () => {
          // TypeScript refuses a comma whose left side does nothing.
          const holder = fresh("library") + "_1";
          lines.push(`const ${holder} = ${requireName}(${source});`);
          for (const offered of wanted)
            add(
              offered,
              offered.callable && !offered.member && kind !== "typescript"
                ? `(0, ${member(holder, offered)})`
                : member(holder, offered),
              false,
            );
        },
        () => {
          lines.push(`${requireName}(${source});`);
          for (const offered of wanted) add(offered, `(${member(`${requireName}(${source})`, offered)})`, false);
        },
      ])();
    const inPlace = () => {
      const rest = wanted.filter(offered => !offered.callable);
      const imported = isLoose ? `((await import(${source})) as any)` : `(await import(${source}))`;
      for (const offered of wanted) if (offered.callable) add(offered, member(imported, offered), false, true);
      // The file runs when this one is loaded, not at the first call.
      if (kind !== "commonjs") lines.push(`import ${source};`);
      else if (!from.awaits) lines.push(`require(${source});`);
      return rest;
    };
    if (kind === "commonjs") {
      if (from.awaits || random.chance(0.15)) {
        if (inPlace().length && !from.awaits) required("require");
        // A class of a file that waits stays out of reach here.
        return { lines, functions, shapes: from.awaits ? [] : shapes };
      }
      required("require");
      return { lines, functions, shapes };
    }
    random.weighted<() => void>([
      [
        // TypeScript does not see every name that a CommonJS file exports.
        isLoose && from.kind === "commonjs" ? 0 : 5,
        () => {
          const names = destructured(" as ");
          const first = names.find(name => name.group[0].exportedAs === "default");
          const isFirstAlone = first !== undefined && random.chance(0.7);
          const braces = names.filter(name => !(isFirstAlone && name === first)).map(name => name.text);
          lines.push(
            `import ${[...(isFirstAlone ? [first.local] : []), ...(braces.length ? [`{ ${braces.join(", ")} }`] : [])].join(", ")} from ${source};`,
          );
          for (const { group, local } of names) {
            const name = loosened(local);
            for (const offered of group) add(offered, name, true);
          }
        },
      ],
      [
        3,
        () => {
          const holder = fresh("library");
          lines.push(`import * as ${holder} from ${source};`);
          const name = loosened(holder);
          for (const offered of wanted) add(offered, member(name, offered), true);
        },
      ],
      [
        mayAwait ? 2 : 0,
        () => {
          if (random.chance(0.5)) {
            const names = destructured(": ");
            lines.push(`const { ${names.map(name => name.text).join(", ")} }${any} = await import(${source});`);
            for (const { group, local } of names) for (const offered of group) add(offered, local, false);
          } else {
            const holder = fresh("library");
            lines.push(`const ${holder}${any} = await import(${source});`);
            for (const offered of wanted) add(offered, member(holder, offered), false);
          }
        },
      ],
      [
        1,
        () => {
          const rest = inPlace();
          if (!rest.length) return;
          const holder = fresh("library");
          lines.push(`import * as ${holder} from ${source};`);
          const name = loosened(holder);
          for (const offered of rest) add(offered, member(name, offered), true);
        },
      ],
      [
        from.awaits ? 0 : 2,
        () => {
          const requireName = fresh("require");
          lines.push(`const ${requireName} = createRequire(import.meta.url);`);
          required(requireName);
        },
      ],
    ])();
    return { lines, functions, shapes };
  }

  const files: File[] = [];

  function addFile(stem: string, role: Part["role"], kind: Kind, loads = ""): File {
    const isPackage = hasMore && role === "library" && kind !== "typescript" && random.chance(0.4);
    const path = (role === "main" ? "" : isPackage ? `node_modules/${stem}/` : "lib/") + stem + extensionOf(kind);
    if (isPackage) {
      const entry = "./" + path.slice(path.lastIndexOf("/") + 1);
      texts[`node_modules/${stem}/package.json`] =
        JSON.stringify(
          {
            name: stem,
            ...(kind === "module" ? { type: "module" } : {}),
            ...random.pick<object>([
              { main: entry },
              { exports: entry },
              { exports: { ".": { import: entry, require: entry } } },
              { main: "./missing.js", exports: { ".": { default: entry } } },
            ]),
          },
          null,
          2,
        ) + "\n";
    }
    const mayAwait = kind !== "commonjs" && (role === "main" || random.chance(0.25));
    const file: File = { path, kind, offers: [], awaits: mayAwait };
    const lines: string[] = [];
    const functions: Callable[] = [];
    const shapes: Shape[] = [];
    const locals = new Set<string>();
    const reachable = files.filter(from => kind !== "commonjs" || from.kind === "commonjs" || mayRequireModules(role));
    const sources = role === "main" ? files : random.sample(reachable, random.between(0, 3));
    // `main` loads every file ahead of those that throw while they are loaded.
    let early = "";
    for (const from of sources) {
      const wanted = random.sample(from.offers, random.between(role === "main" ? 0 : 1, 4));
      if (role === "main" && kind === "commonjs" && from.awaits)
        early += `await import(${specifier(path, from.path)});\n`;
      if (!wanted.length) {
        if (kind !== "commonjs") lines.push(`import ${specifier(path, from.path)};`);
        else if (!from.awaits) lines.push(`require(${specifier(path, from.path)});`);
        continue;
      }
      const taken = take(path, kind, mayAwait, from, wanted, locals);
      lines.push(...taken.lines);
      functions.push(...taken.functions);
      shapes.push(...taken.shapes);
      // What is imported where it is used does not hold the file up.
      if (taken.lines.length) file.awaits ||= from.awaits;
    }
    const heading =
      (kind === "commonjs" && random.chance(0.4) ? '"use strict";\n' : "") +
      takeNames(kind, helperNames(kind === "typescript", isBroad), specifier(path, helpers.path)) +
      (isBroad && kind !== "typescript" ? takeNames(kind, ["Legacy"], specifier(path, legacy.path)) : "") +
      (lines.some(line => line.includes("createRequire(")) ? 'import { createRequire } from "node:module";\n' : "") +
      // Declarations stand behind the imports.
      [...lines.filter(line => line.startsWith("import ")), ...lines.filter(line => !line.startsWith("import "))]
        .map(line => line + "\n")
        .join("") +
      "\n";
    const written = write(random, {
      isTyped: kind === "typescript",
      isCommonJs: kind === "commonjs",
      isBroad,
      part: {
        role,
        counters,
        heading,
        functions,
        shapes,
        mayAwait,
        loads: early + loads,
        mayOmitNames: hasMore,
      },
    });
    texts[path] = written.text;
    file.offers = written.exports;
    return file;
  }

  const drawLibraryKind = () => {
    const kind = drawKind();
    return kind === "commonjs" && helpers.kind !== "commonjs" && !mayRequireModules("library") ? "module" : kind;
  };
  for (let index = random.between(2, 5); index > 0; index--)
    files.push(addFile(fresh("part"), "library", drawLibraryKind()));

  // Two files that need each other.
  if (random.chance(0.5)) {
    const kind = drawLibraryKind();
    const [first, second] = [fresh("circle"), fresh("circle")];
    const [firstPath, secondPath] = [first, second].map(stem => `lib/${stem}${extensionOf(kind)}`);
    const number = kind === "typescript" ? ": number" : "";
    const body = (own: string, other: string, isFirst: boolean) =>
      isFirst
        ? `(depth${number})${number} {\n  return depth % 3 > 0 ? ${other}(depth - 1) : step(depth);\n}`
        : `(depth${number})${number} {\n  return step(depth) + ${other}(depth);\n}`;
    for (const [own, other, path, otherPath, isFirst] of [
      [first, second, firstPath, secondPath, true],
      [second, first, secondPath, firstPath, false],
    ] as const) {
      texts[path] =
        kind === "commonjs"
          ? `exports.${own} = function ${own}${body(own, `other.${other}`, isFirst)};\nconst other = require(${specifier(path, otherPath)});\n` +
            takeNames(kind, ["step"], specifier(path, helpers.path))
          : takeNames(kind, [other], specifier(path, otherPath)) +
            takeNames(kind, ["step"], specifier(path, helpers.path)) +
            `export function ${own}${body(own, other, isFirst)}\n`;
    }
    files.push({
      path: firstPath,
      kind,
      awaits: false,
      offers: [
        { exportedAs: first, callable: { name: first, arity: 1, recordKey: null, isAsync: false, yields: false } },
      ],
    });
  }

  // A file that exports again what others export.
  if (random.chance(0.6)) {
    const kind = drawLibraryKind();
    const path = "lib/index" + extensionOf(kind);
    const barrel: File = { path, kind, offers: [], awaits: false };
    const lines: string[] = [];
    for (const from of random.sample(files, random.between(1, 3))) {
      if (kind === "commonjs" && (from.awaits || (from.kind !== "commonjs" && !mayRequireModules("library")))) continue;
      const source = specifier(path, from.path);
      const named = from.offers.filter(offered => offered.exportedAs !== "default");
      const inside = (holder: string) =>
        from.offers
          .filter(offered => !offered.member)
          .map(offered => ({ ...offered, exportedAs: holder, member: offered.exportedAs }));
      barrel.awaits ||= from.awaits;
      if (kind === "commonjs") {
        random.pick<() => void>([
          () => {
            lines.push(`Object.assign(exports, require(${source}));`);
            barrel.offers.push(...named);
          },
          () => {
            const holder = fresh("inner");
            lines.push(`exports.${holder} = require(${source});`);
            barrel.offers.push(...inside(holder));
          },
          () => {
            for (const offered of named)
              lines.push(`exports.${offered.exportedAs} = require(${source}).${offered.exportedAs};`);
            barrel.offers.push(...named);
          },
        ])();
        continue;
      }
      // TypeScript refuses `export *` of a file that assigns to `module.exports`.
      const mayTakeAll = kind !== "typescript" || from.kind !== "commonjs";
      // TypeScript reads no JavaScript of a package, so it finds no name behind a star over one.
      const isRead = !hasTyped || from.kind === "typescript" || !from.path.startsWith("node_modules/");
      const all = isRead ? "*" : `{ ${[...new Set(named.map(offered => offered.exportedAs))].join(", ")} }`;
      const offersBefore = barrel.offers.length;
      random.weighted<() => void>([
        [
          mayTakeAll ? 1 : 0,
          () => {
            lines.push(`export ${all} from ${source};`);
            barrel.offers.push(...named);
          },
        ],
        [
          mayTakeAll ? 1 : 0,
          () => {
            const holder = fresh("inner");
            lines.push(`export * as ${holder} from ${source};`);
            barrel.offers.push(...inside(holder));
          },
        ],
        [
          1,
          () => {
            const again = [...Map.groupBy(from.offers, offered => offered.exportedAs)].map(([name, group]) => {
              const as = name === "default" || random.chance(0.3) ? fresh("again") : name;
              barrel.offers.push(...group.map(offered => ({ ...offered, exportedAs: as })));
              return name === as ? name : `${name} as ${as}`;
            });
            if (again.length) lines.push(`export { ${again.join(", ")} } from ${source};`);
          },
        ],
      ])();
      if (!isRead)
        for (let index = offersBefore; index < barrel.offers.length; index++) {
          const { shape } = barrel.offers[index];
          if (shape) barrel.offers[index] = { ...barrel.offers[index], shape: { ...shape, isAny: true } };
        }
    }
    if (barrel.offers.length) {
      texts[path] = lines.join("\n") + "\n";
      files.push(barrel);
    }
  }

  let loads = "";
  for (let index = random.between(0, 3); index > 0; index--) {
    const kind = drawKind();
    const stem = fresh("loaded");
    const loaded = addFile(stem, "loaded", kind);
    let target = loaded;
    // Another file may stand between `main` and the file that throws.
    if (random.chance(0.4)) {
      const between: File = {
        kind: loaded.awaits ? "module" : drawKind(),
        path: "",
        offers: [],
        awaits: loaded.awaits,
      };
      between.path = `lib/${fresh("loads")}${extensionOf(between.kind)}`;
      const source = specifier(between.path, loaded.path);
      texts[between.path] =
        between.kind === "commonjs"
          ? random.pick([
              `module.exports = require(${source});\n`,
              `function load() {\n  const loaded = require(${source});\n  return loaded;\n}\nmodule.exports = load();\n`,
              `exports.loaded = [1].map(() => require(${source}));\n`,
              ...(hasMore
                ? [
                    `"use strict";\nfunction load() {\n  return require(${source});\n}\nmodule.exports = load();\n`,
                    `"use strict";\nmodule.exports = (() => require(${source}))();\n`,
                    `"use strict";\nconst load = function () {\n  return module.require(${source});\n};\nexports.loaded = load();\n`,
                    `function load() {\n  return require(${source});\n}\nmodule.exports = load();\n`,
                  ]
                : []),
            ])
          : between.kind === "typescript" && loaded.kind === "commonjs"
            ? `import ${source};\n`
            : random.pick([
                `export * from ${source};\n`,
                `import ${source};\n`,
                `import * as loaded from ${source};\nexport { loaded };\n`,
                ...(hasMore && !loaded.awaits && between.kind === "module"
                  ? [
                      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nfunction load() {\n  return require(${source});\n}\nexport const loaded = load();\n`,
                      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const loaded = (() => require(${source}))();\n`,
                    ]
                  : []),
              ]);
      target = between;
    }
    const source = specifier("main", target.path);
    const load =
      mainKind === "commonjs" && !target.awaits && random.chance(0.7)
        ? `require(${source})`
        : `await import(${source})`;
    loads += `state.failing = ${random.between(1, 8)};
state.calls = 0;
try {
  ${load};
  console.log("${stem}", "is loaded");
} catch (error) {
  console.log("${stem}", framesOf(error));
}
state.failing = 0;
`;
  }

  const main = addFile("main", "main", mainKind, loads);
  const { [main.path]: text, ...rest } = texts;
  return { file: main.path, text, files: rest };
}

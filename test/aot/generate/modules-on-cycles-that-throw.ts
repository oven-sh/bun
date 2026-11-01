// Graphs of modules with a cycle of imports in which one module throws. Every module of the cycle that had been entered by then fails with it, also one whose body had ended:
// whoever asks for it later, by whatever way, gets the same error, and runs nothing. What lies below the cycle, or on a cycle that had ended, stays good and does not run again.
// A program is many graphs that share nothing, each in a folder of its own, and a main.mjs that asks for their modules in turn.

type Body =
  | "ends"
  | "throws"
  | "awaits"
  | "awaits and throws"
  | "throws ahead of its await"
  | "waits"
  | "waits and throws"
  | "throws what it catches"
  | "only hands on";
type Modules = Record<string, [imports: string[], body: Body]>;
type Step = ["import" | "require", string] | ["together", ...string[]];

const prelude = `let errors = [];
function describe(error) {
  if (!errors.includes(error)) errors.push(error);
  return "error " + errors.indexOf(error) + " (" + error.message + ")";
}
async function outcome(label, start) {
  try {
    await start();
    return label + " resolves";
  } catch (error) {
    return label + " rejects: " + describe(error);
  }
}
function call(label, start) {
  try {
    start();
    console.log(label, "returns");
  } catch (error) {
    console.log(label, "throws:", describe(error));
  }
}
`;

function textOfModule(tag: string, imports: string[], body: Body) {
  if (body === "only hands on") return imports.map(target => `export * from "./${target}";\n`).join("");
  const thrown = `throw new Error("${tag}");`;
  const code: Record<Body, string[]> = {
    "ends": [],
    "throws": [thrown],
    "awaits": ["await null;"],
    "awaits and throws": ["await null;", thrown],
    "throws ahead of its await": [`if (globalThis.process) ${thrown}`, "await null;"],
    "waits": ["await new Promise(resolve => setTimeout(resolve, 5));"],
    "waits and throws": ["await new Promise(resolve => setTimeout(resolve, 5));", thrown],
    "throws what it catches": [],
    "only hands on": [],
  };
  return [
    ...imports.map(target => `import "./${target}";`),
    `console.log("${tag} begins");`,
    ...code[body],
    ...(body.includes("throws") ? [] : [`console.log("${tag} ends");`]),
    "",
  ].join("\n");
}

function textOfFile(tag: string, requires: string[], body: Body) {
  return [
    `console.log("${tag} begins");`,
    ...requires.map(
      target =>
        `try { require("./${target}"); console.log("${tag}: require(${target}) returns"); } catch (error) { console.log("${tag}: require(${target}) throws", error.message); ${body === "throws what it catches" ? "throw error; " : ""}}`,
    ),
    ...(body === "throws" ? [`throw new Error("${tag}");`] : ["exports.done = true;", `console.log("${tag} ends");`]),
    "",
  ].join("\n");
}

function program(name: string, says: string, graphs: Record<string, [Modules, Step[]]>, usesRequire = false) {
  const files: Record<string, string> = {};
  const main = [`// ${says}`];
  if (usesRequire) main.push(`import { createRequire } from "node:module";`, `const require = createRequire(import.meta.url);`);
  main.push(prelude);
  const outcome = (graph: string, module: string) => `outcome("import(${module})", () => import("./${graph}/${module}"))`;
  for (const [graph, [modules, steps]] of Object.entries(graphs)) {
    for (const [module, [imports, body]] of Object.entries(modules))
      files[`${name}/${graph}/${module}`] = (module.endsWith(".cjs") ? textOfFile : textOfModule)(`${graph}/${module}`, imports, body);
    main.push(`errors = [];`, `console.log("== ${graph}");`);
    for (const [kind, ...names] of steps) {
      if (kind === "import") main.push(`console.log(await ${outcome(graph, names[0])});`);
      else if (kind === "require") main.push(`call("require(${names[0]})", () => require("./${graph}/${names[0]}"));`);
      else main.push(`for (const line of await Promise.all([${names.map(module => outcome(graph, module)).join(", ")}])) console.log(line);`);
    }
  }
  files[`${name}/main.mjs`] = main.join("\n") + "\n";
  // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
  files[`${name}.json`] =
    `{ "skipInShell": "it needs Bun's modules", "env": { "BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER": "1" } }\n`;
  return files;
}

const upTo = (n: number) => Array.from({ length: n }, (_, index) => index);

/** c0 imports c1, which imports c2 ..; the last imports c0. Entered at c0, the last runs first. */
const ring = (n: number, thrower: number, thrown: Body = "throws", others: Body = "ends"): Modules =>
  Object.fromEntries(upTo(n).map(i => [`c${i}.mjs`, [[`c${(i + 1) % n}.mjs`], i === thrower ? thrown : others]]));

const withImporterOfEach = (n: number, modules: Modules): Modules => ({
  ...modules,
  ...Object.fromEntries(upTo(n).map(k => [`late${k}.mjs`, [[`c${k}.mjs`], "ends"]])),
});

function ringsWithOneLaterAsker() {
  const graphs: Record<string, [Modules, Step[]]> = {};
  for (const n of [2, 3, 5])
    for (const thrower of n < 5 ? upTo(n) : [0, 2, 4])
      for (const asked of upTo(n)) {
        graphs[`of-${n}-c${thrower}-throws-an-importer-of-c${asked}`] = [
          { ...ring(n, thrower), "late.mjs": [[`c${asked}.mjs`], "ends"] },
          [["import", "c0.mjs"], ["import", "late.mjs"], ["import", "late.mjs"], ["import", "c0.mjs"]],
        ];
        graphs[`of-${n}-c${thrower}-throws-an-import-of-c${asked}`] = [
          ring(n, thrower),
          [["import", "c0.mjs"], ["import", `c${asked}.mjs`], ["import", `c${asked}.mjs`]],
        ];
      }
  return graphs;
}

function ringsWithAnImporterOfEach() {
  const graphs: Record<string, [Modules, Step[]]> = {};
  for (const n of [2, 3, 4])
    for (const thrower of upTo(n))
      for (const entered of upTo(n))
        graphs[`of-${n}-c${thrower}-throws-entered-at-c${entered}`] = [
          withImporterOfEach(n, ring(n, thrower)),
          [["import", `late${entered}.mjs`], ...upTo(n).map((k): Step => ["import", `late${k}.mjs`])],
        ];
  return graphs;
}

const pair: Modules = { "a.mjs": [["b.mjs"], "throws"], "b.mjs": [["a.mjs"], "ends"] };
const pairAndLate: Modules = { ...pair, "late.mjs": [["b.mjs"], "ends"] };

const otherShapes: Record<string, [Modules, Step[]]> = {
  "two-lead-back-to-the-root-the-second-throws": [
    { "a.mjs": [["b.mjs", "c.mjs"], "ends"], "b.mjs": [["a.mjs"], "ends"], "c.mjs": [["a.mjs"], "throws"], "late.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "two-lead-back-to-the-root-which-throws": [
    { "a.mjs": [["b.mjs", "c.mjs"], "throws"], "b.mjs": [["a.mjs"], "ends"], "c.mjs": [["a.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"], "latec.mjs": [["c.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "lateb.mjs"], ["import", "latec.mjs"]],
  ],
  "two-cycles-share-a-module": [
    { "a.mjs": [["b.mjs"], "throws"], "b.mjs": [["a.mjs", "c.mjs"], "ends"], "c.mjs": [["b.mjs"], "ends"], "late.mjs": [["c.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "a-cycle-inside-a-cycle": [
    { "a.mjs": [["b.mjs"], "throws"], "b.mjs": [["c.mjs"], "ends"], "c.mjs": [["d.mjs", "a.mjs"], "ends"], "d.mjs": [["c.mjs"], "ends"], "lated.mjs": [["d.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "lated.mjs"], ["import", "lateb.mjs"]],
  ],
  "a-cycle-that-ended-below-a-module-that-throws-stays-good": [
    { "p.mjs": [["a.mjs"], "throws"], "a.mjs": [["b.mjs"], "ends"], "b.mjs": [["a.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"], "latea.mjs": [["a.mjs"], "ends"] },
    [["import", "p.mjs"], ["import", "lateb.mjs"], ["import", "latea.mjs"], ["import", "p.mjs"]],
  ],
  "what-a-member-imports-below-the-cycle-stays-good": [
    { "a.mjs": [["b.mjs"], "throws"], "b.mjs": [["x.mjs", "a.mjs"], "ends"], "x.mjs": [[], "ends"], "latex.mjs": [["x.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "latex.mjs"], ["import", "lateb.mjs"]],
  ],
  "the-module-that-throws-lies-below-the-cycle": [
    { "a.mjs": [["b.mjs"], "ends"], "b.mjs": [["a.mjs", "x.mjs"], "ends"], "x.mjs": [[], "throws"], "latea.mjs": [["a.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "latea.mjs"], ["import", "lateb.mjs"]],
  ],
  "a-member-ended-and-then-a-module-below-the-root-throws": [
    { "a.mjs": [["b.mjs", "x.mjs"], "ends"], "b.mjs": [["a.mjs"], "ends"], "x.mjs": [[], "throws"], "lateb.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "lateb.mjs"]],
  ],
  "an-importer-above-the-cycle-and-what-ran-in-front-of-it": [
    { "p.mjs": [["s.mjs", "a.mjs"], "ends"], "s.mjs": [[], "ends"], ...pair, "lates.mjs": [["s.mjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"], "latep.mjs": [["p.mjs"], "ends"] },
    [["import", "p.mjs"], ["import", "lates.mjs"], ["import", "lateb.mjs"], ["import", "latep.mjs"]],
  ],
  "the-later-importer-lies-two-levels-above": [
    { ...pair, "between.mjs": [["b.mjs"], "ends"], "late.mjs": [["between.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"], ["import", "between.mjs"]],
  ],
  "the-later-importer-imports-a-good-module-first": [
    { ...pair, "good.mjs": [[], "ends"], "late.mjs": [["good.mjs", "b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "the-later-importer-is-on-a-cycle-of-its-own": [
    { ...pair, "l1.mjs": [["l2.mjs"], "ends"], "l2.mjs": [["l1.mjs", "b.mjs"], "ends"], "last.mjs": [["l1.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "l1.mjs"], ["import", "last.mjs"]],
  ],
  "a-member-has-no-code-of-its-own": [
    { "a.mjs": [["between.mjs"], "throws"], "between.mjs": [["a.mjs"], "only hands on"], "late.mjs": [["between.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "a-member-without-code-leads-to-a-module-that-never-ran": [
    { "a.mjs": [["between.mjs"], "ends"], "between.mjs": [["x.mjs", "y.mjs"], "only hands on"], "x.mjs": [["a.mjs"], "throws"], "y.mjs": [[], "ends"], "late.mjs": [["between.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "a-module-imports-itself": [
    { "a.mjs": [["a.mjs"], "throws"], "late.mjs": [["a.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"]],
  ],
  "asked-for-at-once": [pairAndLate, [["together", "a.mjs", "late.mjs", "a.mjs", "late.mjs"]]],
  "asked-for-at-once-the-later-importer-first": [pairAndLate, [["together", "late.mjs", "a.mjs"]]],
};

function cyclesThatAwait() {
  const graphs: Record<string, [Modules, Step[]]> = {};
  for (const thrown of ["awaits and throws", "throws ahead of its await", "waits and throws"] as const)
    for (const others of ["ends", "awaits"] as const)
      for (const n of [2, 3])
        for (const thrower of upTo(n))
          graphs[`of-${n}-c${thrower}-${thrown.replaceAll(" ", "-")}-each-other-${others}`] = [
            withImporterOfEach(n, ring(n, thrower, thrown, others)),
            [["import", "c0.mjs"], ...upTo(n).map((k): Step => ["import", `late${k}.mjs`]), ["import", "c0.mjs"]],
          ];
  for (const n of [2, 3])
    for (const thrower of upTo(n))
      for (const awaiting of upTo(n)) {
        if (awaiting === thrower) continue;
        const modules = ring(n, thrower);
        modules[`c${awaiting}.mjs`][1] = "awaits";
        graphs[`of-${n}-c${thrower}-throws-c${awaiting}-awaits`] = [
          withImporterOfEach(n, modules),
          [["import", "c0.mjs"], ...upTo(n).map((k): Step => ["import", `late${k}.mjs`])],
        ];
      }
  const waiting: Modules = { ...pairAndLate, "a.mjs": [["b.mjs"], "waits and throws"] };
  graphs["asked-for-while-the-root-waits"] = [waiting, [["together", "a.mjs", "late.mjs", "b.mjs"]]];
  graphs["asked-for-while-the-root-waits-and-again"] = [waiting, [["together", "a.mjs", "late.mjs"], ["import", "late.mjs"]]];
  graphs["a-member-waits-and-the-root-throws"] = [
    { ...pairAndLate, "b.mjs": [["a.mjs"], "waits"] },
    [["together", "a.mjs", "late.mjs"], ["import", "late.mjs"]],
  ];
  return graphs;
}

function askedForByRequire() {
  const graphs: Record<string, [Modules, Step[]]> = {
    "required-and-required": [pairAndLate, [["require", "a.mjs"], ["require", "late.mjs"], ["require", "late.mjs"], ["require", "a.mjs"]]],
    "required-and-imported": [pairAndLate, [["require", "a.mjs"], ["import", "late.mjs"]]],
    "imported-and-required": [pairAndLate, [["import", "a.mjs"], ["require", "late.mjs"]]],
    "the-member-is-required": [pairAndLate, [["require", "a.mjs"], ["require", "b.mjs"], ["import", "b.mjs"]]],
  };
  for (const thrower of upTo(3))
    graphs[`of-3-c${thrower}-throws`] = [
      withImporterOfEach(3, ring(3, thrower)),
      [["require", "c0.mjs"], ...upTo(3).map((k): Step => ["require", `late${k}.mjs`])],
    ];
  return graphs;
}

const besideCommonJSFiles: Record<string, [Modules, Step[]]> = {
  "a-file-requires-its-importer": [
    { "a.mjs": [["b.cjs"], "throws"], "b.cjs": [["a.mjs"], "ends"], "late.mjs": [["b.cjs"], "ends"] },
    [["import", "a.mjs"], ["import", "late.mjs"], ["require", "b.cjs"]],
  ],
  "a-file-below-the-cycle-stays-good": [
    { "a.mjs": [["b.mjs"], "throws"], "b.mjs": [["f.cjs", "a.mjs"], "ends"], "f.cjs": [[], "ends"], "latef.mjs": [["f.cjs"], "ends"], "lateb.mjs": [["b.mjs"], "ends"] },
    [["import", "a.mjs"], ["import", "latef.mjs"], ["import", "lateb.mjs"]],
  ],
  "a-file-requires-the-cycle-and-catches": [
    { "f.cjs": [["a.mjs", "late.mjs"], "ends"], ...pairAndLate },
    [["require", "f.cjs"], ["import", "late.mjs"]],
  ],
  "a-file-requires-the-cycle-and-throws-what-it-catches": [
    { "f.cjs": [["a.mjs"], "throws what it catches"], ...pairAndLate, "top.mjs": [["f.cjs"], "ends"] },
    [["import", "top.mjs"], ["import", "late.mjs"], ["import", "top.mjs"]],
  ],
  "a-module-imports-a-file-that-requires-the-cycle": [
    { "top.mjs": [["f.cjs"], "ends"], "f.cjs": [["a.mjs"], "ends"], ...pairAndLate },
    [["import", "top.mjs"], ["import", "late.mjs"]],
  ],
};

export const modulesOnCyclesThatThrow = () => ({
  ...program(
    "rings-of-modules-one-of-which-throws-and-one-later-asker",
    "Rings of two, three and five modules. One of them throws: the first, the last or one between. Then one module of the ring is asked for: by a module that imports it, or by an import() of it.",
    ringsWithOneLaterAsker(),
  ),
  ...program(
    "rings-of-modules-one-of-which-throws-and-a-later-importer-of-each",
    "Rings of two, three and four modules, each of which has an importer outside the ring. The ring is entered through one of these, one module throws, and then every importer is asked for.",
    ringsWithAnImporterOfEach(),
  ),
  ...program(
    "graphs-with-a-cycle-in-which-a-module-throws",
    "Cycles that share modules, lie inside each other, below or above what throws, and what is asked for behind them.",
    otherShapes,
  ),
  ...program(
    "cycles-with-top-level-await-in-which-a-module-throws",
    "Cycles in which the module that throws, or another, awaits at its top level.",
    cyclesThatAwait(),
  ),
  ...program(
    "cycles-in-which-a-module-throws-are-asked-for-by-require",
    "require() is the first to ask for a cycle in which a module throws, or asks later for what imports a module of it.",
    askedForByRequire(),
    true,
  ),
  ...program(
    "cycles-in-which-a-module-throws-beside-commonjs-files",
    "CommonJS files import, or are imported by, the modules of a cycle in which one throws.",
    besideCommonJSFiles,
    true,
  ),
});

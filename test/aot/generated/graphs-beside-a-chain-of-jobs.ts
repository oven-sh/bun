// Graphs of ES modules and CommonJS files that `import()` asks for while a chain of jobs counts turns. Every module logs the turn in which it runs, and the turn in which
// each `import()` settles is logged: so a program prints how many jobs the load of a graph takes.

const logs = (name: string) => `globalThis.log.push("${name}@" + globalThis.turn);\n`;

const start = `globalThis.log = [];
globalThis.turn = 0;
async function one(name, at, small, graph, over) {
  globalThis.log.length = 0;
  globalThis.turn = 0;
  let done = 0;
  const a = small().then(() => {
    globalThis.log.push("small-settles@" + globalThis.turn);
    done++;
  });
  const b = graph().then(() => {
    globalThis.log.push("graph-settles@" + globalThis.turn);
    done++;
  });
  for (let turn = 0; turn < 60 || done < 2; turn++) {
    if (turn === at) {
      try {
        globalThis.log.push("required=" + over().c + "@" + globalThis.turn);
      } catch (error) {
        globalThis.log.push("threw " + error.name);
      }
    }
    await null;
    globalThis.turn++;
  }
  await a;
  await b;
  console.log(name, globalThis.log.join(" "));
}
`;

export const shapesWithRequire = ["plain", "files", "deep", "onway", "both"] as const;

/**
 * A chain of seven modules with a part of six that hangs beside it. In each of the turns a graph of its own: in that turn a `require()` comes into the graph.
 * `plain`, `files`: it takes the part, which hangs high. `deep`: the part hangs low, so the longest way through the graph leads through it.
 * `onway`: it takes the end of the chain. `both`: the end of the chain and half of the part.
 */
export function programWithRequire(shape: (typeof shapesWithRequire)[number], turns: number[]) {
  const depth = 7;
  const files: Record<string, string> = {};
  const hasFiles = shape === "files" || shape === "both";
  let text = start;
  for (const turn of turns) {
    const k = `${shape}${turn}`;
    const hangsAt = shape === "deep" ? depth - 2 : 2;
    for (let level = 0; level < depth; level++) {
      files[`${k}-way${level}.mjs`] =
        (level + 1 < depth ? `import { c as below } from "./${k}-way${level + 1}.mjs";\n` : "const below = 0;\n") +
        (level === hangsAt ? `import { c as part } from "./${k}-part0.mjs";\n` : "const part = 0;\n") +
        (hasFiles && level === 1 ? `import { value as file } from "./${k}-wayfile.cjs";\n` : "const file = 0;\n") +
        logs(`way${level}`) +
        "export const c = below + part + file + 1;\n";
    }
    files[`${k}-wayfile.cjs`] = logs("wayfile") + "exports.value = 1;\n";
    files[`${k}-part0.mjs`] =
      `import { c as a } from "./${k}-part1.mjs";\nimport { c as b } from "./${k}-part2.mjs";\n` +
      logs("part0") +
      "export const c = a + b + 1;\n";
    files[`${k}-part1.mjs`] =
      `import { c as a } from "./${k}-part3.mjs";\n` +
      (hasFiles ? `import { value as f } from "./${k}-file1.cjs";\n` : "const f = 0;\n") +
      logs("part1") +
      "export const c = a + f + 1;\n";
    files[`${k}-part2.mjs`] =
      `import { c as a } from "./${k}-part3.mjs";\nimport { c as b } from "./${k}-part4.mjs";\n` +
      logs("part2") +
      "export const c = a + b + 1;\n";
    files[`${k}-part3.mjs`] = logs("part3") + "export const c = 1;\n";
    files[`${k}-part4.mjs`] =
      (hasFiles ? `import { value as f } from "./${k}-file2.cjs";\n` : "const f = 0;\n") +
      logs("part4") +
      'Promise.resolve().then(() => globalThis.log.push("job-of-part4@" + globalThis.turn));\nexport const c = f + 1;\n';
    files[`${k}-part5.mjs`] = logs("part5") + "export const c = 1;\n";
    files[`${k}-file1.cjs`] = logs("file1") + "exports.value = 1;\n";
    files[`${k}-file2.cjs`] =
      logs("file2") +
      `Promise.resolve().then(() => globalThis.log.push("job-of-file2@" + globalThis.turn));\nexports.value = require("./${k}-part5.mjs").c;\n`;
    files[`${k}-small.mjs`] = logs("small") + "export const c = 1;\n";
    const over = shape === "onway" ? `way${depth - 2}` : shape === "both" ? `way${depth - 3}` : "part0";
    files[`${k}-over.mjs`] =
      `import { c as below } from "./${k}-${over}.mjs";\n` +
      (shape === "both" ? `import { c as second } from "./${k}-part2.mjs";\n` : "const second = 0;\n") +
      logs("over") +
      "export const c = below + second + 1;\n";
    text += `await one("${k}", ${turn}, () => import("./${k}-small.mjs"), () => import("./${k}-way0.mjs"), () => require("./${k}-over.mjs"));\n`;
  }
  return { file: "main.mjs", text, files };
}

/** What each module imports. The root is `r`. */
export const graphsAlone: Record<string, Record<string, string[]>> = {
  "a chain": { r: ["a"], a: ["b"], b: [] },
  "two modules import the lowest": { r: ["a", "b"], a: ["c"], b: ["c"], c: [] },
  "three modules import the lowest": { r: ["a", "b", "c"], a: ["d"], b: ["d"], c: ["d"], d: [] },
  "two modules import one that imports another": { r: ["a", "b"], a: ["c"], b: ["c"], c: ["d"], d: [] },
  "two modules import one, twice on one way": {
    r: ["a", "b"],
    a: ["c"],
    b: ["c"],
    c: ["d", "e"],
    d: ["f"],
    e: ["f"],
    f: [],
  },
  "two modules import one beside a longer way": {
    r: ["a", "b", "x"],
    a: ["c"],
    b: ["c"],
    c: [],
    x: ["y"],
    y: ["z"],
    z: [],
  },
  "a module imports its importer": { r: ["a"], a: ["b"], b: ["a", "c"], c: [] },
};

export function programAlone() {
  const files: Record<string, string> = {};
  let text = start;
  Object.entries(graphsAlone).forEach(([name, graph], index) => {
    for (const [module, imports] of Object.entries(graph))
      files[`g${index}-${module}.mjs`] = imports.map(to => `import "./g${index}-${to}.mjs";\n`).join("") + logs(module);
    files[`g${index}-small.mjs`] = logs("small");
    text += `await one(${JSON.stringify(name)}, -1, () => import("./g${index}-small.mjs"), () => import("./g${index}-r.mjs"));\n`;
  });
  return { file: "main.mjs", text, files };
}

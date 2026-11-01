// A package among the `files` of `Bun.build` is read as one on the disk is: its main fields, its "exports" under the conditions of the
// build. Without `aot` an import finds a file in memory only by its whole name, so those cases have another package of the name on the disk.
// What leads to a file by a rule outside its package finds no file that is only in memory, with `aot` and without it.
import { buildBothWays } from "../build-both-ways";

const main = { "main.ts": `import { from } from "lib"; console.log(from);` };
const onDisk = {
  ...main,
  "node_modules/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "./disk.js" }),
  "node_modules/lib/disk.js": `export const from = "disk";`,
};

// Each of `paths`, from node_modules, exports its own path.
function inMemory(manifest: object, paths: string[]) {
  const text = JSON.stringify(JSON.stringify({ name: "lib", version: "1.0.0", ...manifest }));
  const modules = paths.map(path => `[join(folder, "node_modules/${path}")]: "export const from = '${path}';"`);
  return `files: { [join(folder, "node_modules/lib/package.json")]: ${text}, ${modules.join(", ")} }`;
}

const generated = `files: { [join(folder, "src/generated.ts")]: "export const from: string = 'memory';" }`;
const tsconfigWithPaths = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: [],
    paths: { "@/*": ["./src/*"] },
  },
  exclude: ["build.ts"],
});

buildBothWays("compile/aot/packages in memory", {
  '"module" beside "main"': {
    files: onDisk,
    options: inMemory({ module: "./esm.js", main: "./cjs.js" }, ["lib/esm.js", "lib/cjs.js"]),
    differs: { stdout: "lib/esm.js\n" },
  },
  '"main" without an extension': {
    files: onDisk,
    options: inMemory({ main: "./entry" }, ["lib/entry.ts", "lib/entry.js"]),
    differs: { stdout: "lib/entry.js\n" },
  },
  "a condition of the build": {
    files: onDisk,
    options: `conditions: ["worker"], ${inMemory({ exports: { ".": { worker: "./worker.js", default: "./plain.js" } } }, ["lib/worker.js", "lib/plain.js"])}`,
    differs: { stdout: "lib/worker.js\n" },
  },
  "a target that leaves its package": {
    files: main,
    options: inMemory({ exports: { ".": "../other/index.js" } }, ["other/index.js"]),
    fails: "lib",
  },
  "`paths` of a tsconfig.json on the disk": {
    files: { "main.ts": `import { from } from "@/generated"; console.log(from);`, "tsconfig.json": tsconfigWithPaths },
    options: generated,
    fails: "@/generated",
  },
  '"imports" of a package.json on the disk': {
    files: {
      "main.ts": `import { from } from "#generated"; console.log(from);`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        imports: { "#generated": "./src/generated.ts" },
      }),
    },
    options: generated,
    fails: "#generated",
  },
});

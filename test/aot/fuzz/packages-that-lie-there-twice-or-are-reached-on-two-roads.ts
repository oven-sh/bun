// Small programs over a package that lies in node_modules twice, or once and is reached on two roads (`corners`: how it lies there). The program takes it itself and through a second package that depends on it.
//
//   twice      two versions, one below the package that depends on it, or each below its own; one version in two copies; a file for `import` and a file for `require`; a folder of the project with a node_modules
//              of its own
//   once       found further up; a file for `import` that hands on what the file for `require` holds; named by itself, whole or under a subpath; by name and by path; under two subpaths; through "imports";
//              links as package managers lay them, to a store inside node_modules
//   versions   the class of the second version has its fields in another order, of other kinds, and one more
//   typings    each copy has its own; only the copy further up has some, so that they describe the other copy too; under @types; none, and TypeScript infers them
//   asked      the version, a counter that each copy keeps, whether an instance of one copy is an instance of the class of the other, its fields and methods in functions that instances of both copies reach, once
//              or in a long loop
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

export const corners = [
  "two versions, the older below the package that depends on it",
  "two versions, each below the package that depends on it",
  "one version in two copies",
  "one copy further up",
  "a file for import and a file for require",
  "a file for import that hands on the file for require",
  "a folder of the project with a node_modules of its own",
  "a package that names itself",
  "a package that names itself under a subpath",
  "by name and by path",
  "under two subpaths",
  'through "imports" of the project',
  'through "imports" of the package that depends on it',
  "links to a store",
  "links to a store that holds two versions",
  "a link to a folder of the project",
] as const;

export function generate(
  random: Random,
  corner: (typeof corners)[number],
): { file: string; text: string; files: Record<string, string>; links?: Record<string, string> } {
  // The relations first.
  const isDual = corner.startsWith("a file for import");
  const isCommonJS = !isDual && random.chance(0.35);
  const typings = random.weighted([
    [4, "each has its own"],
    [3, "only the copy further up"],
    [2, "@types"],
    [2, "inferred"],
  ] as const);
  const turns = random.pick([1, 3, 10000]);
  const isProgramTyped = random.chance(0.75);
  const order = random.pick(["mine first", "theirs first"] as const);
  const isReadApart = random.chance(0.4);

  const dependency = (version: number, asCommonJS: boolean) => {
    const fields = version === 1 ? `  a = 1;\n  b = "one";\n` : `  b = "two";\n  a = 2.5;\n  c = [2];\n`;
    const body =
      `const version = ${version};\nlet count = 0;\nfunction next() {\n  return ++count;\n}\nclass Thing {\n${fields}  tag() {\n    return "version ${version}";\n  }\n}\n` +
      `function make() {\n  return new Thing();\n}\nfunction isThing(value) {\n  return value instanceof Thing;\n}\n`;
    return asCommonJS
      ? `${body}exports.version = version;\nexports.next = next;\nexports.Thing = Thing;\nexports.make = make;\nexports.isThing = isThing;\n`
      : `${body}export { version, next, Thing, make, isThing };\n`;
  };
  const declared = (version: number) =>
    `export declare const version: number;\nexport declare function next(): number;\nexport declare class Thing {\n${version === 1 ? "  a: number;\n  b: string;\n" : "  b: string;\n  a: number;\n  c: number[];\n"}  tag(): string;\n}\nexport declare function make(): Thing;\nexport declare function isThing(value: unknown): boolean;\n`;
  const manifest = (name: string, version: number, more: object = {}) =>
    JSON.stringify(
      { name, version: `${version}.0.0`, ...(isCommonJS ? {} : { type: "module" }), main: "./index.js", ...more },
      null,
      2,
    ) + "\n";
  const user = (from: string) =>
    isCommonJS
      ? `const dependency = require(${from});\nexports.theirVersion = dependency.version;\nexports.theirNext = () => dependency.next();\nexports.theirs = () => dependency.make();\nexports.isTheirs = value => dependency.isThing(value);\nexports.Theirs = dependency.Thing;\n`
      : `import { version, next, make, isThing, Thing } from ${from};\nexport const theirVersion = version;\nexport const theirNext = () => next();\nexport const theirs = () => make();\nexport const isTheirs = value => isThing(value);\nexport { Thing as Theirs };\n`;
  const userDeclared = (from: string) =>
    `import { Thing } from ${from};\nexport declare const theirVersion: number;\nexport declare function theirNext(): number;\nexport declare function theirs(): Thing;\nexport declare function isTheirs(value: unknown): boolean;\nexport declare const Theirs: typeof Thing;\n`;

  const files: Record<string, string> = {};
  const links: Record<string, string> = {};
  /** Lays a copy of the package down. `isFurtherUp`: TypeScript finds it from everywhere. */
  const lay = (folder: string, version: number, isFurtherUp: boolean, more: object = {}) => {
    const hasTypings = typings === "each has its own" || (typings === "only the copy further up" && isFurtherUp);
    files[`${folder}/package.json`] = manifest("dependency", version, {
      ...(hasTypings && { types: "./index.d.ts" }),
      ...more,
    });
    files[`${folder}/index.js`] = dependency(version, isCommonJS);
    if (hasTypings) files[`${folder}/index.d.ts`] = declared(version);
    if (typings === "@types" && isFurtherUp) {
      files["node_modules/@types/dependency/package.json"] =
        `{ "name": "@types/dependency", "version": "${version}.0.0", "types": "./index.d.ts" }\n`;
      files["node_modules/@types/dependency/index.d.ts"] = declared(version);
    }
  };
  const layUser = (folder: string, from = `"dependency"`, more: object = {}) => {
    files[`${folder}/package.json`] = manifest("depends", 1, {
      ...(typings !== "inferred" && { types: "./index.d.ts" }),
      ...more,
    });
    files[`${folder}/index.js`] = user(from);
    if (typings !== "inferred") files[`${folder}/index.d.ts`] = userDeclared(from);
  };

  let mine = `"dependency"`;
  let theirs = `"depends"`;
  switch (corner) {
    case "two versions, the older below the package that depends on it":
      lay("node_modules/dependency", 2, true);
      lay("node_modules/depends/node_modules/dependency", 1, false);
      layUser("node_modules/depends");
      break;
    case "two versions, each below the package that depends on it":
      lay("node_modules/depends/node_modules/dependency", 1, false);
      layUser("node_modules/depends");
      lay("node_modules/dependency", 2, true);
      files["node_modules/other/package.json"] = manifest(
        "other",
        1,
        typings !== "inferred" ? { types: "./index.d.ts" } : {},
      );
      files["node_modules/other/index.js"] = isCommonJS
        ? `module.exports = require("dependency");\n`
        : `export * from "dependency";\n`;
      if (typings !== "inferred") files["node_modules/other/index.d.ts"] = `export * from "dependency";\n`;
      files["node_modules/other/node_modules/dependency/package.json"] = files["node_modules/dependency/package.json"];
      files["node_modules/other/node_modules/dependency/index.js"] = files["node_modules/dependency/index.js"];
      if (files["node_modules/dependency/index.d.ts"])
        files["node_modules/other/node_modules/dependency/index.d.ts"] = files["node_modules/dependency/index.d.ts"];
      mine = `"other"`;
      break;
    case "one version in two copies":
      lay("node_modules/dependency", 2, true);
      lay("node_modules/depends/node_modules/dependency", 2, false);
      layUser("node_modules/depends");
      break;
    case "one copy further up":
      lay("node_modules/dependency", 2, true);
      layUser("node_modules/depends");
      break;
    case "a file for import and a file for require":
    case "a file for import that hands on the file for require": {
      lay("node_modules/dependency", 2, true, {
        exports: { ".": { types: "./index.d.ts", import: "./index.js", require: "./index.cjs" } },
      });
      if (!files["node_modules/dependency/index.d.ts"]) files["node_modules/dependency/index.d.ts"] = declared(2);
      files["node_modules/dependency/index.cjs"] = dependency(2, true);
      if (corner.endsWith("hands on the file for require"))
        files["node_modules/dependency/index.js"] =
          `import whole from "./index.cjs";\nexport const { version, next, Thing, make, isThing } = whole;\n`;
      files["node_modules/depends/package.json"] =
        JSON.stringify({ name: "depends", version: "1.0.0", main: "./index.js", types: "./index.d.ts" }, null, 2) +
        "\n";
      files["node_modules/depends/index.js"] =
        `const dependency = require("dependency");\nexports.theirVersion = dependency.version;\nexports.theirNext = () => dependency.next();\nexports.theirs = () => dependency.make();\nexports.isTheirs = value => dependency.isThing(value);\nexports.Theirs = dependency.Thing;\n`;
      files["node_modules/depends/index.d.ts"] = userDeclared(`"dependency"`);
      break;
    }
    case "a folder of the project with a node_modules of its own":
      lay("node_modules/dependency", 2, true);
      lay("part/node_modules/dependency", 1, false);
      files[`part/index.${isProgramTyped ? "ts" : "js"}`] = isProgramTyped
        ? `import { version, next, make, isThing, Thing } from "dependency";\nexport const theirVersion = version;\nexport const theirNext = () => next();\nexport const theirs = () => make();\nexport const isTheirs = (value: unknown) => isThing(value);\nexport { Thing as Theirs };\n`
        : `import { version, next, make, isThing, Thing } from "dependency";\nexport const theirVersion = version;\nexport const theirNext = () => next();\nexport const theirs = () => make();\nexport const isTheirs = value => isThing(value);\nexport { Thing as Theirs };\n`;
      theirs = isProgramTyped ? `"./part/index"` : `"./part/index.js"`;
      break;
    case "a package that names itself":
    case "a package that names itself under a subpath": {
      const isWhole = corner === "a package that names itself";
      lay("node_modules/dependency", 2, true, {
        exports: {
          ".": { types: "./index.d.ts", default: "./index.js" },
          "./user": { types: "./user.d.ts", default: "./user.js" },
          "./inner": { types: "./index.d.ts", default: "./index.js" },
        },
      });
      if (!files["node_modules/dependency/index.d.ts"]) files["node_modules/dependency/index.d.ts"] = declared(2);
      files["node_modules/dependency/user.js"] = user(isWhole ? `"dependency"` : `"dependency/inner"`);
      files["node_modules/dependency/user.d.ts"] = userDeclared(isWhole ? `"dependency"` : `"dependency/inner"`);
      theirs = `"dependency/user"`;
      break;
    }
    case "by name and by path":
      lay("node_modules/dependency", 2, true);
      files[`depends.${isCommonJS ? "cjs" : "mjs"}`] = user(`"./node_modules/dependency/index.js"`);
      files[`depends.d.${isCommonJS ? "cts" : "mts"}`] = userDeclared(`"dependency"`);
      theirs = `"./depends.${isCommonJS ? "cjs" : "mjs"}"`;
      break;
    case "under two subpaths":
      lay("node_modules/dependency", 2, true, {
        exports: {
          ".": { types: "./index.d.ts", default: "./index.js" },
          "./again": { types: "./index.d.ts", default: "./index.js" },
        },
      });
      if (!files["node_modules/dependency/index.d.ts"]) files["node_modules/dependency/index.d.ts"] = declared(2);
      layUser("node_modules/depends", `"dependency/again"`);
      break;
    case 'through "imports" of the project':
      lay("node_modules/dependency", 2, true);
      layUser("node_modules/depends");
      files["package.json"] =
        JSON.stringify({ name: "project", type: "module", imports: { "#dependency": "dependency" } }, null, 2) + "\n";
      mine = `"#dependency"`;
      break;
    case 'through "imports" of the package that depends on it':
      lay("node_modules/dependency", 2, true);
      lay("node_modules/depends/vendored", 1, false);
      layUser("node_modules/depends", `"#dependency"`, {
        imports: { "#dependency": { types: "./vendored/index.d.ts", default: "./vendored/index.js" } },
      });
      if (!files["node_modules/depends/vendored/index.d.ts"])
        files["node_modules/depends/vendored/index.d.ts"] = declared(typings === "each has its own" ? 1 : 2);
      break;
    case "links to a store":
      lay("node_modules/.store/dependency@2.0.0/node_modules/dependency", 2, true);
      layUser("node_modules/.store/depends@1.0.0/node_modules/depends");
      links["node_modules/dependency"] = ".store/dependency@2.0.0/node_modules/dependency";
      links["node_modules/depends"] = ".store/depends@1.0.0/node_modules/depends";
      links["node_modules/.store/depends@1.0.0/node_modules/dependency"] =
        "../../dependency@2.0.0/node_modules/dependency";
      break;
    case "links to a store that holds two versions":
      lay("node_modules/.store/dependency@2.0.0/node_modules/dependency", 2, true);
      lay("node_modules/.store/dependency@1.0.0/node_modules/dependency", 1, false);
      layUser("node_modules/.store/depends@1.0.0/node_modules/depends");
      links["node_modules/dependency"] = ".store/dependency@2.0.0/node_modules/dependency";
      links["node_modules/depends"] = ".store/depends@1.0.0/node_modules/depends";
      links["node_modules/.store/depends@1.0.0/node_modules/dependency"] =
        "../../dependency@1.0.0/node_modules/dependency";
      break;
    case "a link to a folder of the project":
      lay("packages/dependency", 2, true);
      layUser("packages/depends");
      links["node_modules/dependency"] = "../packages/dependency";
      links["node_modules/depends"] = "../packages/depends";
      break;
  }

  // Both copies reach `read`. It asks for what both versions have; `c` is there in the second version alone.
  const typed = (text: string) => (isProgramTyped ? text : "");
  const reads =
    `function read(thing${typed(": { a: number; b: string; tag(): string }")}) {\n  return thing.a + " " + thing.b + " " + thing.tag();\n}\n` +
    `function more(thing${typed(": object")}) {\n  return "c" in thing ? JSON.stringify(thing.c) : "none";\n}\n`;
  const ask = (label: string, made: string) =>
    turns === 1
      ? `console.log("${label}", read(${made}), more(${made}));\n`
      : `{\n  let last = "";\n  for (let turn = 0; turn < ${turns}; turn++) last = read(${made});\n  console.log("${label}", last, more(${made}));\n}\n`;
  const asked =
    order === "mine first"
      ? ask("mine", "make()") + ask("theirs", "theirs()")
      : ask("theirs", "theirs()") + ask("mine", "make()");
  const extension = isProgramTyped ? "ts" : "mjs";
  if (isReadApart) files[`reads.${extension}`] = reads.replaceAll(/^function/gm, "export function");
  const text =
    `import { version, next, Thing, make, isThing } from ${mine};\nimport { theirVersion, theirNext, theirs, isTheirs, Theirs } from ${theirs};\n` +
    (isReadApart ? `import { read, more } from "./reads${isProgramTyped ? "" : ".mjs"}";\n` : reads) +
    `console.log("versions", version, theirVersion);\nconsole.log("counters", next(), next(), theirNext(), next());\n` +
    `console.log("one class", Thing === Theirs, theirs() instanceof Thing, make() instanceof Theirs, isThing(theirs()), isTheirs(make()));\n` +
    asked +
    `console.log("whole", JSON.stringify(make()), JSON.stringify(theirs()), Object.keys(theirs()).join());\n`;
  files["tsconfig.json"] =
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: true,
          types: [],
          ...(typings === "inferred" || !isProgramTyped ? { allowJs: true, maxNodeModuleJsDepth: 2 } : {}),
        },
      },
      null,
      2,
    ) + "\n";
  return { file: `main.${extension}`, text, files, ...(Object.keys(links).length && { links }) };
}

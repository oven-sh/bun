// Small programs in which one import could take its types from several places, and each place says something else: it declares `given` with a literal type that names the place. The program assigns `given` to a
// variable of the type that one place declares. TypeScript accepts the program where that is the place it reads, and reports TS2322 where it is another. A build accepts and reports the same. What runs is the
// JavaScript, which knows nothing of all this: the executable prints what plain Bun prints. In this order are drawn:
//
//   what is imported  a package, with and without a scope; a path inside a package; a file, with its ending, with none, `.mjs`, `.cjs`; a folder; a name of "imports" in package.json; a package that lies twice,
//                     beside the file that imports it and further up
//   the places        `declare module` in the project; "paths" in tsconfig.json; "exports" with "types" first, last, inside "import" and "require", under a condition of the project's own, as a text, as a
//                     pattern; "typesVersions"; "typings"; "types"; a file beside the main file; `index.d.ts`; typings under @types; a `.ts`, `.tsx` or `.d.ts` beside the file; what is inferred from the
//                     JavaScript; package.json and `index.d.ts` of a folder. Each is there or not
//   who imports       the first file, or a file in a folder below it; by `import`, or `import lib = require(..)`
//   what is expected  what the place says that TypeScript reads; in one program of eight, what another place says
import type { Random } from "./random";

export const imported = [
  "a package",
  "a path inside a package",
  "a file",
  "a folder",
  "a name of imports",
  "a package that lies twice",
] as const;
export type Imported = (typeof imported)[number];

const says = (place: string) => `export declare const given: ${JSON.stringify(place)};\n`;
const runs = (place: string, isCommon = false) =>
  `${isCommon ? "exports.given" : "export const given"} = ${JSON.stringify("runs: " + place)};\n`;

export function generate(
  random: Random,
  what: Imported = random.pick(imported),
  isRefused = random.chance(0.125),
): { file: string; text: string; files: Record<string, string>; isRefused: boolean } {
  const files: Record<string, string> = {};
  const options: Record<string, unknown> = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  };
  /** The places that are there, the one that TypeScript reads first. */
  const places: string[] = [];
  const has = (chance = 0.5) => random.chance(chance);
  const isBelow = what === "a package that lies twice" || has(0.3);
  const byRequire = has(0.15);
  const up = isBelow ? "../" : "./";
  let specifier: string;

  const scope = has(0.3) ? "@scope/" : "";
  const name = `${scope}lib`;
  const typings = `node_modules/@types/${scope ? "scope__lib" : "lib"}/`;
  const atTypes = (path: string, place: string) => {
    files[`${typings}package.json`] =
      JSON.stringify({ name: `@types/${scope ? "scope__lib" : "lib"}`, version: "1.0.0" }, null, 2) + "\n";
    files[`${typings}${path}`] = says(place);
  };
  const isCommon = byRequire || has(0.25);

  switch (what) {
    case "a package": {
      specifier = name;
      const folder = `node_modules/${name}/`;
      const about: Record<string, unknown> = {
        name,
        version: "1.0.0",
        type: isCommon ? "commonjs" : "module",
        main: "./main.js",
      };
      files[`${folder}main.js`] = runs("the package", isCommon);
      if (has(0.2)) {
        files["ambient.d.ts"] =
          `declare module ${JSON.stringify(name)} {\n  export const given: "declare module";\n}\n`;
        places.push("declare module");
      }
      if (has(0.2)) {
        options.paths = { [name]: ["./mapped/lib"] };
        files["mapped/lib.d.ts"] = says("paths");
        files["mapped/lib.js"] = runs("paths");
        places.push("paths");
      }
      const exports = random.weighted([
        [5, "none"],
        [2, "types first"],
        [1, "types last"],
        [2, "inside import and require"],
        [1, "a text"],
        [1, "a condition of the project"],
        [1, "without a way for types"],
      ] as const);
      if (exports === "types first") {
        about.exports = { ".": { types: "./exported.d.ts", default: "./main.js" } };
        files[`${folder}exported.d.ts`] = says("exports");
        places.push("exports");
      } else if (exports === "types last") {
        // The first condition that leads to declarations decides: the file beside the main file, if there is one.
        about.exports = { ".": { default: "./main.js", types: "./exported.d.ts" } };
        files[`${folder}exported.d.ts`] = says("exports");
      } else if (exports === "inside import and require") {
        about.exports = {
          ".": {
            import: { types: "./import.d.ts", default: "./main.js" },
            require: { types: "./require.d.ts", default: "./main.js" },
          },
        };
        files[`${folder}import.d.ts`] = says("import");
        files[`${folder}require.d.ts`] = says("require");
        places.push(byRequire ? "require" : "import");
      } else if (exports === "a text") about.exports = "./main.js";
      else if (exports === "a condition of the project") {
        options.customConditions = ["own"];
        about.exports = {
          ".": {
            own: { types: "./condition.d.ts", default: "./main.js" },
            types: "./exported.d.ts",
            default: "./main.js",
          },
        };
        files[`${folder}condition.d.ts`] = says("own");
        files[`${folder}exported.d.ts`] = says("exports");
        places.push("own");
      } else if (exports === "without a way for types") about.exports = { ".": { default: "./main.js" } };
      const isOpen = exports === "none";
      if (isOpen && has(0.15)) {
        about.typesVersions = { "*": { "*": ["versioned/*"] } };
        about.types = "./own.d.ts";
        files[`${folder}versioned/own.d.ts`] = says("typesVersions");
        files[`${folder}own.d.ts`] = says("types");
        places.push("typesVersions");
      } else {
        if (has(0.3)) {
          about.typings = "./typings.d.ts";
          files[`${folder}typings.d.ts`] = says("typings");
          if (isOpen) places.push("typings");
        }
        if (has(0.4)) {
          about.types = "./own.d.ts";
          files[`${folder}own.d.ts`] = says("types");
          if (isOpen) places.push("types");
        }
      }
      if (has(0.4)) {
        files[`${folder}main.d.ts`] = says("beside the main file");
        if (!["types first", "inside import and require", "a condition of the project"].includes(exports))
          places.push("beside the main file");
      }
      if (exports === "types last") places.push("exports");
      if (has(0.4)) {
        files[`${folder}index.d.ts`] = says("index.d.ts");
        if (isOpen) places.push("index.d.ts");
      }
      if (has(0.4) || !places.length) {
        atTypes("index.d.ts", "@types");
        places.push("@types");
      }
      files[`${folder}package.json`] = JSON.stringify(about, null, 2) + "\n";
      break;
    }
    case "a path inside a package": {
      const writesEnd = has(0.4);
      specifier = `${name}/sub${writesEnd ? ".js" : ""}`;
      const folder = `node_modules/${name}/`;
      const about: Record<string, unknown> = {
        name,
        version: "1.0.0",
        type: isCommon ? "commonjs" : "module",
        main: "./main.js",
      };
      files[`${folder}main.js`] = runs("the main file", isCommon);
      files[`${folder}sub.js`] = runs("the path", isCommon);
      const exports = random.weighted([
        [4, "none"],
        [2, "the path"],
        [2, "a pattern"],
      ] as const);
      const key = `./sub${writesEnd ? ".js" : ""}`;
      if (exports === "the path") {
        about.exports = { ".": "./main.js", [key]: { types: "./typed/sub.d.ts", default: "./sub.js" } };
        files[`${folder}typed/sub.d.ts`] = says("exports");
        places.push("exports");
      } else if (exports === "a pattern") {
        about.exports = {
          ".": "./main.js",
          [writesEnd ? "./*.js" : "./*"]: { types: "./typed/*.d.ts", default: "./*.js" },
        };
        files[`${folder}typed/sub.d.ts`] = says("a pattern");
        places.push("a pattern");
      }
      if (has(0.5)) {
        files[`${folder}sub.d.ts`] = says("beside the file");
        if (exports === "none") places.push("beside the file");
      }
      if (!writesEnd && has(0.3)) {
        files[`${folder}sub/index.d.ts`] = says("a folder");
        if (exports === "none") places.push("a folder");
      }
      if (has(0.4) || !places.length) {
        atTypes("sub.d.ts", "@types");
        places.push("@types");
      }
      files[`${folder}package.json`] = JSON.stringify(about, null, 2) + "\n";
      break;
    }
    case "a file": {
      const end = random.pick(["js", "js", "", "mjs", "cjs"]);
      specifier = `${up}lib${end && "." + end}`;
      const real = end || "js";
      files[`lib.${real}`] = runs("the file", real === "cjs");
      const [typed, declared] = { js: ["ts", "d.ts"], mjs: ["mts", "d.mts"], cjs: ["cts", "d.cts"] }[real]!;
      if (has(0.2)) {
        files[`lib.${typed}`] = `export const given = "TypeScript" as const;\n`;
        places.push("TypeScript");
      }
      if (real === "js" && has(0.15)) {
        files["lib.tsx"] = `export const given = "tsx" as const;\n`;
        options.jsx = "preserve";
        places.push("tsx");
      }
      if (has(0.6)) {
        files[`lib.${declared}`] = says("a declaration file");
        places.push("a declaration file");
      }
      if (real !== "js" && has(0.3)) files["lib.d.ts"] = says("a declaration file with another ending");
      if (has(0.4) || !places.length) {
        options.allowJs = true;
        places.push("runs: the file");
      }
      break;
    }
    case "a folder": {
      specifier = `${up}lib`;
      files["lib/index.js"] = runs("the folder");
      if (has(0.25)) {
        files["lib.d.ts"] = says("a file of that name");
        files["lib.js"] = runs("a file of that name");
        places.push("a file of that name");
      }
      if (has(0.4)) {
        files["lib/package.json"] = JSON.stringify({ types: "./typed.d.ts", main: "./index.js" }, null, 2) + "\n";
        files["lib/typed.d.ts"] = says("types");
        places.push("types");
      }
      if (has(0.5) || !places.length) {
        files["lib/index.d.ts"] = says("index.d.ts");
        places.push("index.d.ts");
      }
      break;
    }
    case "a name of imports": {
      specifier = "#lib";
      files["lib.js"] = runs("the file");
      const form = random.pick(["types first", "a text", "types last"] as const);
      files["package.json"] =
        JSON.stringify(
          {
            name: "program",
            type: "module",
            imports: {
              "#lib":
                form === "a text"
                  ? "./lib.js"
                  : form === "types first"
                    ? { types: "./typed/lib.d.ts", default: "./lib.js" }
                    : { default: "./lib.js", types: "./typed/lib.d.ts" },
            },
          },
          null,
          2,
        ) + "\n";
      files["typed/lib.d.ts"] = says("imports");
      if (form === "types first") places.push("imports");
      if (has(0.5) || form !== "types first") {
        files["lib.d.ts"] = says("beside the file");
        places.push("beside the file");
      }
      break;
    }
    case "a package that lies twice": {
      specifier = name;
      for (const [folder, place] of [
        [`src/node_modules/${name}/`, "near"],
        [`node_modules/${name}/`, "far"],
      ]) {
        const isTyped = place === "far" || has(0.6);
        files[`${folder}package.json`] =
          JSON.stringify(
            { name, version: "1.0.0", type: "module", main: "./main.js", ...(isTyped && { types: "./own.d.ts" }) },
            null,
            2,
          ) + "\n";
        files[`${folder}main.js`] = runs(place);
        if (isTyped) {
          files[`${folder}own.d.ts`] = says(place);
          places.push(place);
        }
      }
      break;
    }
  }

  // What the program expects: what the first place says, or what another says.
  const others = [
    "declare module",
    "paths",
    "exports",
    "types",
    "typings",
    "index.d.ts",
    "@types",
    "beside the main file",
    "a declaration file",
    "near",
    "far",
    "imports",
  ].filter(place => place !== places[0]);
  const expected = isRefused ? (places.length > 1 ? random.pick(places.slice(1)) : random.pick(others)) : places[0];
  const text =
    [
      byRequire
        ? `import lib = require(${JSON.stringify(specifier)});`
        : random.chance(0.3)
          ? `import * as lib from ${JSON.stringify(specifier)};`
          : `import { given } from ${JSON.stringify(specifier)};`,
      `const expected: ${JSON.stringify(expected)} = ${"GIVEN"};`,
      "console.log(expected);",
    ].join("\n") + "\n";
  const written = text.replace("GIVEN", text.includes("{ given }") ? "given" : "lib.given");
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: options }, null, 2) + "\n";
  if (!isBelow) return { file: "main.ts", text: written, files, isRefused };
  files["src/user.ts"] = written;
  return { file: "main.ts", text: `import "./src/user";\n`, files, isRefused };
}

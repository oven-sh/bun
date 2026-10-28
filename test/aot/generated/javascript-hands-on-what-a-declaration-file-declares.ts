// A TypeScript file imports from a JavaScript file, which has it from code that a declaration file describes.
// The type checker reads the declaration for the import in the JavaScript file too, so the TypeScript file sees the declared types.
// The cases cross: how the JavaScript file hands the members on, its extension, where the declaration is, and whether it fits the code.
//   bun generated/javascript-hands-on-what-a-declaration-file-declares.ts <folder>   writes each project into a folder of its own
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Files = Record<string, string>;

// What the file in between holds, given the specifier of the code and the members that it names.
type Way = { extensions: string[]; text: (from: string, members: string[]) => string; under?: string };
const ways: Record<string, Way> = {
  "import and export": {
    extensions: [".js", ".mjs", ".jsx"],
    text: (from, members) => `import { ${members.join(", ")} } from ${from};\nexport { ${members.join(", ")} };\n`,
  },
  "export from": {
    extensions: [".js", ".mjs", ".jsx"],
    text: (from, members) => `export { ${members.join(", ")} } from ${from};\n`,
  },
  "export star": {
    extensions: [".js", ".mjs", ".jsx"],
    text: from => `export * from ${from};\n`,
  },
  "export star as": {
    extensions: [".js", ".mjs", ".jsx"],
    text: from => `export * as all from ${from};\n`,
    under: "all",
  },
  "members of a namespace": {
    extensions: [".js", ".mjs", ".jsx"],
    text: (from, members) =>
      `import * as all from ${from};\n` + members.map(member => `export const ${member} = all.${member};\n`).join(""),
  },
  "import call": {
    extensions: [".js", ".mjs"],
    text: (from, members) => `export const { ${members.join(", ")} } = await import(${from});\n`,
  },
  "require": {
    extensions: [".js", ".cjs"],
    text: (from, members) =>
      `const { ${members.join(", ")} } = require(${from});\nmodule.exports = { ${members.join(", ")} };\n`,
  },
  "require handed on whole": {
    extensions: [".js", ".cjs"],
    text: from => `module.exports = require(${from});\n`,
  },
};

const moduleCode = `export const given = "text";
export function make(a = 0) {
  return a + "!";
}
export class Box {
  constructor(held = 0) {
    this.held = String(held);
  }
}
`;
const commonjsCode = `exports.given = "text";
exports.make = function make(a = 0) {
  return a + "!";
};
exports.Box = class Box {
  constructor(held = 0) {
    this.held = String(held);
  }
};
`;

// `primitive` stands for what the three members hold or answer with.
const declarations = {
  right: { primitive: "string", members: ["given", "make", "Box"] },
  wrong: { primitive: "number", members: ["given", "make", "Box"] },
  partial: { primitive: "string", members: ["given"] },
};
type Fit = keyof typeof declarations;

function declare(fit: Fit, keyword: string) {
  const { primitive, members } = declarations[fit];
  const lines: Record<string, string> = {
    given: `export ${keyword}const given: ${primitive};`,
    make: `export ${keyword}function make(a: number): ${primitive};`,
    Box: `export ${keyword}class Box {\n  held: ${primitive};\n  constructor(held: number);\n}`,
  };
  return members.map(member => lines[member]).join("\n") + "\n";
}

// The files of the code and of its declaration below `folder`, for a package named `name`, and the specifier that finds the code.
const places: Record<string, (folder: string, name: string, fit: Fit) => { from: string; files: Files }> = {
  "d.ts beside js": (folder, _, fit) => ({
    from: "./maker.js",
    files: { [`${folder}/maker.js`]: moduleCode, [`${folder}/maker.d.ts`]: declare(fit, "declare ") },
  }),
  "d.ts beside js, no extension written": (folder, _, fit) => ({
    from: "./maker",
    files: { [`${folder}/maker.js`]: moduleCode, [`${folder}/maker.d.ts`]: declare(fit, "declare ") },
  }),
  "d.mts beside mjs": (folder, _, fit) => ({
    from: "./maker.mjs",
    files: { [`${folder}/maker.mjs`]: moduleCode, [`${folder}/maker.d.mts`]: declare(fit, "declare ") },
  }),
  "d.cts beside cjs": (folder, _, fit) => ({
    from: "./maker.cjs",
    files: { [`${folder}/maker.cjs`]: commonjsCode, [`${folder}/maker.d.cts`]: declare(fit, "declare ") },
  }),
  "types of a package": (_, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        type: "module",
        main: "./maker.js",
        types: "./declared.d.ts",
      }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`node_modules/${name}/declared.d.ts`]: declare(fit, "declare "),
    },
  }),
  "typings of a package": (_, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        type: "module",
        main: "./maker.js",
        typings: "./declared.d.ts",
      }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`node_modules/${name}/declared.d.ts`]: declare(fit, "declare "),
    },
  }),
  "types condition of a package": (_, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        type: "module",
        exports: { ".": { types: "./declared.d.ts", default: "./maker.js" } },
      }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`node_modules/${name}/declared.d.ts`]: declare(fit, "declare "),
    },
  }),
  "index.d.ts of a package": (_, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: "module", main: "./maker.js" }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`node_modules/${name}/index.d.ts`]: declare(fit, "declare "),
    },
  }),
  "@types": (_, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: "module", main: "./maker.js" }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`node_modules/@types/${name}/package.json`]: JSON.stringify({ name: `@types/${name}`, types: "index.d.ts" }),
      [`node_modules/@types/${name}/index.d.ts`]: declare(fit, "declare "),
    },
  }),
  "declare module": (folder, name, fit) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: "module", main: "./maker.js" }),
      [`node_modules/${name}/maker.js`]: moduleCode,
      [`${folder}/ambient.d.ts`]: `declare module "${name}" {\n${declare(fit, "")}}\n`,
    },
  }),
};

const placesWithoutDeclaration: typeof places = {
  "js alone": folder => ({ from: "./maker.js", files: { [`${folder}/maker.js`]: moduleCode } }),
  "package without types": (_, name) => ({
    from: name,
    files: {
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: "module", main: "./maker.js" }),
      [`node_modules/${name}/maker.js`]: moduleCode,
    },
  }),
};

export type Case = { way: string; extension: string; place: string; fit: Fit };

export function cases(): Case[] {
  const all: Case[] = [];
  for (const [way, { extensions }] of Object.entries(ways)) {
    for (const place of Object.keys(places)) {
      for (const fit of Object.keys(declarations) as Fit[]) {
        // Every extension meets every way, each place and each fit; the first extension meets all of them crossed.
        for (const [at, extension] of extensions.entries()) {
          const isSampled = at === 0 || (all.length + at) % 3 === 0;
          if (isSampled) all.push({ way, extension, place, fit });
        }
      }
    }
  }
  return all;
}

export const configurations: Record<string, object> = {
  "allowJs": { allowJs: true },
  "allowJs and checkJs": { allowJs: true, checkJs: true },
  "neither": {},
};

function tsconfig(more: object) {
  const compilerOptions = {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    jsx: "preserve",
    types: [],
    ...more,
  };
  return JSON.stringify({ compilerOptions }) + "\n";
}

function filesOf(index: number, { way, extension, place, fit }: Case, reads: string[] = declarations[fit].members) {
  const folder = `case${index}`;
  const { from, files } = { ...places, ...placesWithoutDeclaration }[place](folder, `made${index}`, fit);
  const { text, under } = ways[way];
  files[`${folder}/between${extension}`] = text(JSON.stringify(from), reads);
  const { primitive } = declarations[fit];
  const names = under ? [under] : reads;
  const imports = `import { ${names.map(name => `${name} as ${name}${index}`).join(", ")} } from "./${folder}/between${extension}";\n`;
  const member = (name: string) => (under ? `${under}${index}.${name}` : `${name}${index}`);
  const uses: Record<string, string> = {
    given: `const given${index}Held: ${primitive} = ${member("given")};\nshow(${index}, "given", given${index}Held);\n`,
    make: `const made${index}: ${primitive} = ${member("make")}(${index});\nshow(${index}, "make", made${index});\n`,
    Box: `const held${index}: ${primitive} = new ${member("Box")}(${index}).held;\nshow(${index}, "Box", held${index});\n`,
  };
  return { files, imports, uses: reads.map(name => uses[name]).join("") };
}

const show = `function show(index: number, member: string, value: string | number) {
  console.log(index, member, typeof value, value, typeof value === "number" ? value + 1 : value.length);
}
`;

/** One project that holds every case, each in a folder of its own. The type checker accepts it. */
export function project(configuration: string, chosen: Case[] = cases()): Files {
  const all: Files = { "tsconfig.json": tsconfig(configurations[configuration]) };
  let [imports, uses] = ["", ""];
  for (const [index, one] of chosen.entries()) {
    const made = filesOf(index, one);
    Object.assign(all, made.files);
    imports += made.imports;
    uses += made.uses;
  }
  all["main.ts"] = imports + show + uses;
  return all;
}

/**
 * Projects of one case each, which the type checker accepts or refuses by the case:
 * one reads a member that the declaration leaves out, another has no declaration at all.
 */
export function projectsOfOneCase(): Record<string, Files> {
  const all: Record<string, Files> = {};
  const add = (name: string, one: Case, reads: string[]) => {
    const made = filesOf(0, one, reads);
    all[name] = {
      "tsconfig.json": tsconfig({ allowJs: true }),
      ...made.files,
      "main.ts": made.imports + show + made.uses,
    };
  };
  for (const [way, { extensions }] of Object.entries(ways)) {
    const extension = extensions[0];
    for (const place of Object.keys(places)) {
      add(`${way}, ${place}, a member that is not declared`, { way, extension, place, fit: "partial" }, [
        "given",
        "make",
      ]);
    }
  }
  for (const [way, { extensions }] of Object.entries(ways)) {
    const extension = extensions[0];
    for (const place of Object.keys(placesWithoutDeclaration)) {
      add(`${way}, ${place}`, { way, extension, place, fit: "right" }, ["given", "make", "Box"]);
    }
  }
  return all;
}

if (import.meta.main) {
  const write = (folder: string, files: Files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), text);
    }
  };
  const [where] = process.argv.slice(2);
  for (const configuration of Object.keys(configurations)) {
    write(join(where, "whole", configuration.replaceAll(" ", "-")), project(configuration));
  }
  for (const [index, one] of cases().entries()) write(join(where, "alone", String(index)), project("allowJs", [one]));
  for (const [name, files] of Object.entries(projectsOfOneCase())) {
    write(join(where, "one-case", name.replace(/[^\w.@]+/g, "-")), files);
  }
}

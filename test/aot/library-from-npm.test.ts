import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const sourcesOf = (version: string) => ({
  "tsconfig.json": tsconfig,
  "package.json": JSON.stringify({ name: "shapes", version }),
  "src/index.ts": `import { area } from "./area";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += area(shape);
  return sum;
}
`,
  "src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? 3 * shape.size ** 2 : shape.size ** 2;
}
`,
  "src/version.ts": `export const version: string = "${version}";\n`,
});

const under = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [`${folder}/${path}`, text]));

const application = {
  "tsconfig.json": tsconfig,
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "app.ts": `import { total } from "shapes";
import { version } from "shapes/version";
console.log(total([{ kind: "square", size: 2 }, { kind: "circle", size: 1 }]), version);
`,
};

const project = { ...under("library", sourcesOf("1.2.3")), ...under("app", application) };

const environment = (root: string) => ({
  ...bunEnv,
  NO_COLOR: "1",
  BUN_INSTALL_CACHE_DIR: join(root, "cache"),
  BUN_INSTALL: join(root, "bun-install"),
});

async function bun(root: string, folder: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await spawned([bunExe(), ...args], join(root, folder), environment(root));
  expect({ args, stderr: stderr.split("\n").filter(line => /^error/.test(line)), exitCode }).toEqual({
    args,
    stderr: [],
    exitCode: 0,
  });
  return stdout;
}

const build = (root: string, folder = "library") =>
  bun(root, folder, "compile", "--library", "src/index.ts", "src/version.ts");

async function pack(root: string, folder = "library") {
  await build(root, folder);
  return (await bun(root, `${folder}/dist`, "pm", "pack", "--quiet", "--destination", root)).trim();
}

async function compile(root: string, folder = "app", entry = "app.ts") {
  const app = join(root, folder);
  const built = await spawned([bunExe(), "compile", `./${entry}`], app, environment(root));
  const said = (built.stdout + built.stderr)
    .split(/\r?\n/)
    .filter(line => /typed version|without (its |their )?types/.test(line) && !/^\s*\[/.test(line))
    .map(line => line.replaceAll(root, "<root>").replaceAll("\\", "/"));
  const name = entry.replace(/\.[a-z]+$/, isWindows ? ".exe" : "");
  const ran = built.exitCode === 0 ? await spawned([join(app, name)], app, environment(root)) : undefined;
  const plain = await spawned([bunExe(), entry], app, environment(root));
  return { said, exitCode: built.exitCode, signal: built.signal, stdout: ran?.stdout, plain: plain.stdout };
}

const used = (where: string, version = "1.2.3") =>
  `note: "shapes" ${version} is compiled from its typed version in ${where}`;
const unused = (why: string, where = "node_modules/shapes") =>
  `warn: "shapes" is compiled without types, because its typed version in ${where} can't be used: ${why}`;
const differs = (stem: string) => `${stem}.aot.ts without its types doesn't match ${stem}.js. Was the package patched?`;
const compiled = (said: string[], stdout = "7 1.2.3\n") => ({ said, exitCode: 0, signal: null, stdout, plain: stdout });

const sceneOf =
  (declare: typeof test | typeof test.todo) =>
  (name: string, body: (root: string) => Promise<void>, files: Record<string, string> = project) =>
    declare(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-library-from-npm", files);
          await body(String(dir));
        }),
      600_000,
    );
const scene = sceneOf(test);
const sceneNotMetYet = sceneOf(test.todo);

describe.concurrent(
  "bun compile, with no flag and no setup, uses the typed files of a package from bun compile --library",
  () => {
    scene("that bun add installed from its tarball", async root => {
      await bun(root, "app", "add", await pack(root));
      expect(await compile(root)).toEqual(compiled([used("node_modules/shapes")]));
    });

    scene("that the isolated linker installed", async root => {
      await bun(root, "app", "add", "--linker", "isolated", await pack(root));
      const { said, ...rest } = await compile(root);
      expect(rest).toEqual((({ said, ...rest }) => rest)(compiled([])));
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(
        /^note: "shapes" 1\.2\.3 is compiled from its typed version in node_modules\/\.bun\/shapes@[^/]+\/node_modules\/shapes$/,
      );
    });

    scene("that bun add installed from its folder", async root => {
      await build(root);
      await bun(root, "app", "add", "../library/dist");
      expect(await compile(root)).toEqual(compiled([used("node_modules/shapes")]));
    });

    scene("that bun link links", async root => {
      await build(root);
      await bun(root, "library/dist", "link");
      await bun(root, "app", "link", "shapes");
      expect(await compile(root)).toEqual(compiled([used("<root>/library/dist")]));
    });

    scene(
      "that is a workspace whose own package.json points into dist",
      async root => {
        await build(root, "packages/shapes");
        await bun(root, ".", "install");
        expect(await compile(root, "packages/app")).toEqual(compiled([used("<root>/packages/shapes/dist")]));
      },
      {
        "package.json": JSON.stringify({ name: "workspaces", private: true, workspaces: ["packages/*"] }),
        ...under("packages/shapes", {
          ...sourcesOf("1.2.3"),
          "package.json": JSON.stringify({
            name: "shapes",
            version: "1.2.3",
            type: "module",
            exports: {
              ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
              "./version": { types: "./dist/version.d.ts", default: "./dist/version.js" },
            },
          }),
        }),
        ...under("packages/app", {
          ...application,
          "package.json": JSON.stringify({ name: "app", type: "module", dependencies: { shapes: "workspace:*" } }),
        }),
      },
    );

    scene(
      "in two versions, each from its own files",
      async root => {
        await bun(root, "app", "add", await pack(root));
        await build(root, "newer");
        cpSync(join(root, "newer/dist"), join(root, "app/node_modules/other/node_modules/shapes"), { recursive: true });
        expect(await compile(root)).toEqual(
          compiled(
            [used("node_modules/shapes"), used("node_modules/other/node_modules/shapes", "1.2.4")],
            "7 1.2.3\n1.2.4\n",
          ),
        );
      },
      {
        ...project,
        ...under("newer", sourcesOf("1.2.4")),
        "app/app.ts": application["app.ts"] + `import { theirs } from "other";\nconsole.log(theirs);\n`,
        "app/node_modules/other/package.json": JSON.stringify({
          name: "other",
          version: "1.0.0",
          type: "module",
          main: "index.js",
          types: "index.d.ts",
        }),
        "app/node_modules/other/index.js": `export { version as theirs } from "shapes/version";\n`,
        "app/node_modules/other/index.d.ts": `export declare const theirs: string;\n`,
      },
    );
  },
);

describe.concurrent("bun compile, with no flag and no setup, uses the typed files that bun build --dts wrote", () => {
  const typed = (stem: string) => ({ types: `./${stem}.d.ts`, "bun-aot": `./${stem}.aot.ts`, default: `./${stem}.js` });
  const untyped = (stem: string) => ({ types: `./${stem}.d.ts`, default: `./${stem}.js` });
  const entryPoints = ["src/index.ts", "src/version.ts"];

  scene(
    "where the package.json that was written by hand has the condition",
    async root => {
      await bun(root, "library", "build", ...entryPoints, "--outdir", "dist", "--dts");
      await bun(
        root,
        "app",
        "add",
        (await bun(root, "library", "pm", "pack", "--quiet", "--destination", root)).trim(),
      );
      expect(await compile(root)).toEqual(compiled([used("node_modules/shapes/dist")]));
    },
    {
      ...project,
      "library/package.json": JSON.stringify({
        name: "shapes",
        version: "1.2.3",
        type: "module",
        exports: { ".": typed("dist/index"), "./version": typed("dist/version") },
        files: ["dist"],
      }),
    },
  );

  scene(
    "for import, in a package that also has CommonJS",
    async root => {
      await bun(root, "library", "build", ...entryPoints, "--outdir", "dist/esm", "--dts");
      await bun(root, "library", "build", ...entryPoints, "--outdir", "dist/cjs", "--dts", "--format=cjs");
      writeFileSync(join(root, "library/dist/cjs/package.json"), JSON.stringify({ type: "commonjs" }));
      await bun(
        root,
        "app",
        "add",
        (await bun(root, "library", "pm", "pack", "--quiet", "--destination", root)).trim(),
      );
      expect(await compile(root)).toEqual(compiled([used("node_modules/shapes/dist/esm")]));
      expect(await compile(root, "app", "app.cjs")).toEqual(compiled([]));
    },
    {
      ...project,
      "app/app.cjs": `const { total } = require("shapes");
const { version } = require("shapes/version");
console.log(total([{ kind: "square", size: 2 }, { kind: "circle", size: 1 }]), version);
`,
      "library/package.json": JSON.stringify({
        name: "shapes",
        version: "1.2.3",
        type: "module",
        exports: {
          ".": { import: typed("dist/esm/index"), require: untyped("dist/cjs/index") },
          "./version": { import: typed("dist/esm/version"), require: untyped("dist/cjs/version") },
        },
        files: ["dist"],
      }),
    },
  );
});

describe.concurrent(
  "a typed file that can't be used is a warning, and the JavaScript is compiled without types",
  () => {
    const installed = async (root: string) => {
      await bun(root, "app", "add", "--backend=copyfile", await pack(root));
      return join(root, "app/node_modules/shapes");
    };
    const edit = (path: string, from: string, to: string) => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain(from);
      writeFileSync(path, text.replace(from, to));
    };

    scene("the JavaScript was patched by hand", async root => {
      edit(join(await installed(root), "index.js"), "3 * shape.size", "4 * shape.size");
      expect(await compile(root)).toEqual(compiled([unused(differs("index"))], "8 1.2.3\n"));
    });

    scene("the JavaScript was patched by bun patch", async root => {
      const shapes = await installed(root);
      await bun(root, "app", "patch", "shapes");
      edit(join(shapes, "index.js"), "3 * shape.size", "4 * shape.size");
      await bun(root, "app", "patch", "--commit", "node_modules/shapes");
      expect(await compile(root)).toEqual(compiled([unused(differs("index"))], "8 1.2.3\n"));
    });

    scene(
      "the typed file belongs to another version",
      async root => {
        const shapes = await installed(root);
        await build(root, "newer");
        cpSync(join(root, "newer/dist/version.aot.ts"), join(shapes, "version.aot.ts"));
        expect(await compile(root)).toEqual(compiled([unused(differs("version"))]));
      },
      { ...project, ...under("newer", sourcesOf("1.2.4")) },
    );

    scene("the typed file does not parse", async root => {
      writeFileSync(join(await installed(root), "index.aot.ts"), "export const = ;\n");
      expect(await compile(root)).toEqual(compiled([unused(differs("index"))]));
    });

    scene("the typed file has a type error", async root => {
      edit(join(await installed(root), "version.aot.ts"), "version: string", "version: number");
      expect(await compile(root)).toEqual(
        compiled([
          `warn: TS100009: 'shapes' has 1 type error (the first at <root>/app/node_modules/shapes/version.aot.ts:2:5), so 1 of its 2 files are compiled without their types. They still work, but run slower.`,
        ]),
      );
    });

    scene("one typed file is missing", async root => {
      rmSync(join(await installed(root), "index.aot.ts"));
      expect(await compile(root)).toEqual(compiled([unused("index.aot.ts is missing")]));
    });

    scene("every typed file is missing", async root => {
      const shapes = await installed(root);
      rmSync(join(shapes, "index.aot.ts"));
      rmSync(join(shapes, "version.aot.ts"));
      expect(await compile(root)).toEqual(
        compiled([unused("index.aot.ts is missing"), unused("version.aot.ts is missing")]),
      );
    });
  },
);

describe.concurrent("the tsconfig.json of the application does not count against the typed files of a package", () => {
  const applicationWith = (compilerOptions: object, program: string) => ({
    "app/package.json": application["package.json"],
    "app/tsconfig.json": JSON.stringify({
      compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, ...compilerOptions },
    }),
    "app/app.ts": program,
  });
  const libraryOf = (name: string, source: string) => ({
    "library/tsconfig.json": tsconfig,
    "library/package.json": JSON.stringify({ name, version: "1.0.0" }),
    "library/src/index.ts": source,
  });
  const install = async (root: string) => {
    await bun(root, "library", "compile", "--library");
    const tarball = await bun(root, "library/dist", "pm", "pack", "--quiet", "--destination", root);
    await bun(root, "app", "add", tarball.trim());
  };
  const note = (name: string) => `note: "${name}" 1.0.0 is compiled from its typed version in node_modules/${name}`;

  scene(
    "nodenext, and every flag beyond strict",
    async root => {
      await install(root);
      expect(await compile(root)).toEqual(compiled([note("options")], "a b c\n"));
    },
    {
      ...libraryOf(
        "options",
        `export interface Options {
  name?: string;
}
export function make(name: string | undefined): Options {
  return { name };
}
export function first(names: string[]): string {
  return names[0];
}
export function read(options: { [key: string]: string }): string {
  return options.name;
}
`,
      ),
      ...applicationWith(
        {
          module: "nodenext",
          moduleResolution: "nodenext",
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          noPropertyAccessFromIndexSignature: true,
          noImplicitOverride: true,
          noImplicitReturns: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          verbatimModuleSyntax: true,
          isolatedModules: true,
          erasableSyntaxOnly: true,
        },
        `import { first, make, read } from "options";\nconsole.log(make("a").name, first(["b"]), read({ name: "c" }));\n`,
      ),
    },
  );

  sceneNotMetYet(
    "exactOptionalPropertyTypes, where the package has a conditional type over Partial",
    async root => {
      await install(root);
      expect(await compile(root)).toEqual(compiled([note("forms")], "b\n"));
    },
    {
      ...libraryOf(
        "forms",
        `type Options = { all: boolean; dot: boolean };
type Component<T> =
  | string
  | (T extends { all: false } ? never : T extends { all: true } | { all: boolean } ? string[] : never);
type Nested<T> = { [key: string]: Component<T> | Nested<T> };
type Value<T> =
  | Component<T>
  | (T extends { dot: false } ? never : T extends { dot: true } | { dot: boolean } ? Nested<T> : never);
export function store(form: Record<string, string>, key: string, value: Value<Partial<Options>>): void {
  form[key] = value;
}
`,
      ),
      ...applicationWith(
        { exactOptionalPropertyTypes: true },
        `import { store } from "forms";\nconst form: Record<string, string> = {};\nstore(form, "a", "b");\nconsole.log(form["a"]);\n`,
      ),
    },
  );
});

describe.concurrent("bun compile finds the typed file of a package.json that was written by hand", () => {
  const greeter = (format: string) => ({
    javascript: `function greet(options) {\n  return "${format} " + options.name;\n}\n`,
    typed: `interface Options {\n  name: string;\n}\nfunction greet(options: Options): string {\n  return "${format} " + options.name;\n}\n`,
    declarations: `export interface Options {\n  name: string;\n}\nexport declare function greet(options: Options): string;\n`,
  });
  const [esm, cjs] = [greeter("esm"), greeter("cjs")];
  const dual = {
    "tsconfig.json": tsconfig,
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      version: "1.0.0",
      type: "module",
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          import: { types: "./dist/index.d.ts", "bun-aot": "./dist/index.aot.ts", default: "./dist/index.js" },
          require: { types: "./dist/index.d.cts", "bun-aot": "./dist/index.aot.cts", default: "./dist/index.cjs" },
        },
      },
    }),
    "node_modules/dual/dist/index.js": esm.javascript + "export { greet };\n",
    "node_modules/dual/dist/index.aot.ts": esm.typed + "export { greet };\n",
    "node_modules/dual/dist/index.d.ts": esm.declarations,
    "node_modules/dual/dist/index.cjs": cjs.javascript + "module.exports = { greet };\n",
    "node_modules/dual/dist/index.aot.cts": cjs.typed + "module.exports = { greet };\n",
    "node_modules/dual/dist/index.d.cts": cjs.declarations,
    "app.ts": `import { greet } from "dual";\nconsole.log(greet({ name: "Ada" }));\n`,
    "app.cjs": `const { greet } = require("dual");\nconsole.log(greet({ name: "Ada" }));\n`,
  };
  const note = `note: "dual" 1.0.0 is compiled from its typed version in node_modules/dual/dist`;

  scene(
    "under import, in a package that has ES modules and CommonJS",
    async root => expect(await compile(root, ".", "app.ts")).toEqual(compiled([note], "esm Ada\n")),
    dual,
  );

  scene(
    "under require, in a package that has ES modules and CommonJS",
    async root => expect(await compile(root, ".", "app.cjs")).toEqual(compiled([note], "cjs Ada\n")),
    dual,
  );

  scene(
    "under a pattern, which need not have a typed file for every file",
    async root => {
      mkdirSync(join(root, "node_modules/many/typed"), { recursive: true });
      for (const name of ["one", "two", "three"]) {
        writeFileSync(join(root, `node_modules/many/lib/${name}.js`), `export const name = "${name}";\n`);
        writeFileSync(join(root, `node_modules/many/lib/${name}.d.ts`), `export declare const name: string;\n`);
        if (name !== "three")
          writeFileSync(join(root, `node_modules/many/typed/${name}.ts`), `export const name: string = "${name}";\n`);
      }
      expect(await compile(root, ".", "app.ts")).toEqual(
        compiled(
          [`note: "many" 1.0.0 is compiled from its typed version in node_modules/many/typed`],
          "one two three\n",
        ),
      );
    },
    {
      "tsconfig.json": tsconfig,
      "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
      "node_modules/many/package.json": JSON.stringify({
        name: "many",
        version: "1.0.0",
        type: "module",
        exports: { "./*": { types: "./lib/*.d.ts", "bun-aot": "./typed/*.ts", default: "./lib/*.js" } },
      }),
      "node_modules/many/lib/.keep": "",
      "app.ts": `import { name as one } from "many/one";\nimport { name as two } from "many/two";\nimport { name as three } from "many/three";\nconsole.log(one, two, three);\n`,
    },
  );
});

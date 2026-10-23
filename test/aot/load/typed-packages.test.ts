import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;

function expectNoSignal({ signal, stderr }: Awaited<ReturnType<typeof spawned>>) {
  expect({ signal, stderr: signal ? stderr : "" }).toEqual({ signal: null, stderr: "" });
}

async function run(folder: string, entry: string, flags: string[] = [], argument = "") {
  const program = join(folder, isWindows ? "program.exe" : "program");
  const command = [bunExe(), "build", "--compile", "--aot", ...flags, "./" + entry, "--outfile", program];
  const build = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  expectNoSignal(build);
  const lines = (build.stdout + build.stderr).split(/\r?\n/);
  const messages = (prefix: string) =>
    lines.filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length));
  let stdout: string | undefined;
  if (build.exitCode === 0) {
    const ran = await spawned([program, argument], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expectNoSignal(ran);
    stdout = ran.stdout;
  }
  return {
    errors: messages("error: "),
    warnings: messages("warn: "),
    notes: messages("note: "),
    output: lines.join("\n"),
    exitCode: build.exitCode,
    wroteExecutable: existsSync(program),
    stdout,
  };
}

const tsconfig = (compilerOptions: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
      lib: ["ESNext", "DOM"],
      skipLibCheck: false,
      ...compilerOptions,
    },
  });

// The value comes from the command line: a constant of the wrong type would be a build error.
const probe = (imports: string, calls: string[]) => `${imports}declare const process: { argv: string[] };
const input: any = process.argv[2];
function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(${calls.map(call => `attempt(() => ${call})`).join(", ")});
`;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const installed = {
  "package.json": JSON.stringify({
    name: "shapes",
    version: "1.2.3",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
  }),
  "index.js": 'export { area } from "./area.js";\nexport { perimeter } from "./perimeter.js";\n',
  "area.js": "export function area(w, h) {\n  return w * h;\n}\n",
  "perimeter.js": "export function perimeter(w, h) {\n  return (w - -h) * 2;\n}\n",
  "index.d.ts":
    "export declare function area(w: number, h: number): number;\n" +
    "export declare function perimeter(w: number, h: number): number;\n",
};

const annotate = (text: string) => text.replace("(w, h)", "(w: number, h: number): number");
const typed = { "area.js": annotate(installed["area.js"]), "perimeter.js": annotate(installed["perimeter.js"]) };

const manifest = (overrides: object = {}) => ({
  sound: 2,
  name: "shapes",
  version: "1.2.3",
  when: {},
  lay: { "area.js": sha256(installed["area.js"]), "perimeter.js": sha256(installed["perimeter.js"]) },
  needs: [],
  ...overrides,
});

const prefixPaths = (folder: string, files: Files): Files =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [`${folder}/${path}`, text]));

function project(sound: object | null = manifest()): Files {
  return {
    "tsconfig.json": tsconfig(),
    "package.json": JSON.stringify({ name: "app" }),
    "main.ts": probe('import { area, perimeter } from "shapes";\n', ["area(input, 7)", "perimeter(input, 7)"]),
    ...prefixPaths("node_modules/shapes", installed),
    ...(sound && { ".sound/shapes/sound.json": JSON.stringify(sound), ...prefixPaths(".sound/shapes/lay", typed) }),
  };
}

function otherPackage(version: string): Files {
  const text = "exports.one = 1;\n";
  return {
    "node_modules/other/package.json": JSON.stringify({ name: "other", version, main: "index.js" }),
    "node_modules/other/index.js": text,
    ".sound/other/sound.json": JSON.stringify({
      sound: 2,
      name: "other",
      version: "1.0.0",
      lay: { "index.js": sha256(text) },
      needs: ["shapes"],
    }),
    ".sound/other/lay/index.js": text,
  };
}

function write(folder: string, path: string, text: string) {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), text);
}

const setManifest = (overrides: object) => (folder: string) =>
  write(folder, ".sound/shapes/sound.json", JSON.stringify(manifest(overrides)));

const runProject = (folder: string, flags: string[] = []) => run(folder, "main.ts", flags, "6");

// The argument is a string where the typed version declares a number. The call takes the slow path, so both versions print the same.
const PRINTED = "42 26\n";
const USED = '"shapes" 1.2.3 is compiled from its typed version in .sound/shapes';
const unused = (reason: string) => `TS100056: The typed version of "shapes" in .sound/shapes can't be used: ${reason}`;

const usesTypedVersion = { errors: [], warnings: [], notes: [USED], exitCode: 0, stdout: PRINTED };
const compilesAsInstalled = { errors: [], warnings: [], notes: [], exitCode: 0, stdout: PRINTED };
const compilesAsInstalledAndSaysWhy = (reason: string) => ({ ...compilesAsInstalled, warnings: [unused(reason)] });

const PRODUCTION_ONLY = { when: { "process.env.NODE_ENV": "production" } };
const defineNodeEnv = (value: string) => ["--define", `process.env.NODE_ENV="${value}"`];

const NEEDS_PRODUCTION = `it needs process.env.NODE_ENV to be defined as "production". Pass --define 'process.env.NODE_ENV="production"'`;
const NEEDS_OTHER = 'it needs the typed version of "other", which is not used';
const UNSUPPORTED_FORMAT = `this version of Bun doesn't support the "sound" version in its sound.json`;
const ERASURE_DIFFERS = "lay/perimeter.js without its types doesn't match perimeter.js. Was the package patched?";
const EMITS_CODE = "in lay/perimeter.js, TypeScript syntax that emits code can't be erased";

type Mismatch = [name: string, change: (folder: string) => void, reason: string, flags?: string[]];

const mismatches: Mismatch[] = [
  [
    "a different version is installed",
    folder => write(folder, "node_modules/shapes/package.json", installed["package.json"].replace("1.2.3", "1.2.4")),
    "it is for version 1.2.3, but 1.2.4 is installed. Replace it with the typed version for 1.2.4, or remove it",
  ],
  ["the required define is missing", setManifest(PRODUCTION_ONLY), NEEDS_PRODUCTION],
  ["the required define has another value", setManifest(PRODUCTION_ONLY), NEEDS_PRODUCTION, defineNodeEnv("staging")],
  ["a needed typed version is missing", setManifest({ needs: ["other"] }), NEEDS_OTHER],
  ["format 1", setManifest({ sound: 1 }), UNSUPPORTED_FORMAT],
  ["an unknown format", setManifest({ sound: 99 }), UNSUPPORTED_FORMAT],
  [
    "it adds a file",
    folder => {
      setManifest({ lay: { ...manifest().lay, "extra.ts": "new" } })(folder);
      write(folder, ".sound/shapes/lay/extra.ts", "export {};\n");
    },
    "it adds extra.ts, and a typed version can only replace installed files",
  ],
  [
    "a typed file is missing",
    folder => rmSync(join(folder, ".sound/shapes/lay/perimeter.js")),
    "lay/perimeter.js is missing",
  ],
  ["lay is empty", setManifest({ lay: {} }), '"lay" in its sound.json is empty'],
  [
    "sound.json is not JSON",
    folder => write(folder, ".sound/shapes/sound.json", "{"),
    "its sound.json is not valid JSON",
  ],
  [
    "a path escapes the package",
    setManifest({ lay: { "../other/index.js": sha256("") } }),
    '"../other/index.js" in its sound.json is not a path inside the package',
  ],
  ["the name does not match its folder", setManifest({ name: "forms" }), "its sound.json is not valid"],
];

const neededPackages: [name: string, version: string, expected: object][] = [
  ["two packages that need each other are both used", "1.0.0", usesTypedVersion],
  ["a needed package fails its own pins", "1.0.1", compilesAsInstalledAndSaysWhy(NEEDS_OTHER)],
];

const rejectedFiles: [name: string, text: string, reason: string][] = [
  ["different operator", typed["perimeter.js"].replace("(w - -h)", "(w + -h)"), ERASURE_DIFFERS],
  ["different literal", typed["perimeter.js"].replace("* 2", "* 3"), ERASURE_DIFFERS],
  ["syntax that emits code", "enum Kind { A }\n", EMITS_CODE],
  ["added syntax that emits code", typed["perimeter.js"] + "enum Kind { A }\n", EMITS_CODE],
];

describe.concurrent("compile/aot/load/typed-packages", () => {
  test(
    "used when every pin matches",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", project());
        const folder = String(dir);
        expect(await runProject(folder)).toMatchObject(usesTypedVersion);
        expect(readFileSync(join(folder, "node_modules/shapes/area.js"), "utf8")).toBe(installed["area.js"]);
        expect(await spawned([bunExe(), "run", "main.ts", "6"], folder, bunEnv)).toMatchObject({
          stdout: PRINTED,
          exitCode: 0,
        });
      }),
    600_000,
  );

  test(
    "no typed version",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", project(null));
        expect(await runProject(String(dir))).toMatchObject(compilesAsInstalled);
      }),
    600_000,
  );

  test(
    "a typed version of a package the program never loads is ignored",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", { ...project(), ".sound/unused/sound.json": "{" });
        expect(await runProject(String(dir))).toMatchObject(usesTypedVersion);
      }),
    600_000,
  );

  // A default keeps `flags` out of the callback's length: bun:test passes `done` to a callback longer than its case.
  test.each(mismatches)(
    "compiles the installed files and says why: %s",
    (_, change, reason, flags = []) =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", project());
        change(String(dir));
        expect(await runProject(String(dir), flags)).toMatchObject(compilesAsInstalledAndSaysWhy(reason));
      }),
    600_000,
  );

  test(
    "used when the build defines the required value",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", project(manifest(PRODUCTION_ONLY)));
        expect(await runProject(String(dir), defineNodeEnv("production"))).toMatchObject(usesTypedVersion);
      }),
    600_000,
  );

  test.each(neededPackages)(
    "needs: %s",
    (_, version, expected) =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", {
          ...project(manifest({ needs: ["other"] })),
          ...otherPackage(version),
        });
        expect(await runProject(String(dir))).toMatchObject(expected);
      }),
    600_000,
  );

  test.each(rejectedFiles)(
    "erasure rejects one file: %s",
    (_, text, reason) =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", { ...project(), ".sound/shapes/lay/perimeter.js": text });
        expect(await runProject(String(dir))).toMatchObject(compilesAsInstalledAndSaysWhy(reason));
      }),
    600_000,
  );

  test(
    "erasure accepts different types over the same code",
    () =>
      slot(async () => {
        const text = typed["perimeter.js"].replace("h: number)", "h: number | undefined)").replace("-h", "-h!");
        using dir = tempDir("aot-typed-packages", { ...project(), ".sound/shapes/lay/perimeter.js": text });
        expect(await runProject(String(dir))).toMatchObject(usesTypedVersion);
      }),
    600_000,
  );

  test(
    "a typed file imports a file of the package that has no typed version",
    () =>
      slot(async () => {
        const area = 'import { scale } from "./scale.js";\n' + installed["area.js"].replace("w * h", "w * h * scale");
        using dir = tempDir("aot-typed-packages", {
          ...project(manifest({ lay: { ...manifest().lay, "area.js": sha256(area) } })),
          "node_modules/shapes/area.js": area,
          "node_modules/shapes/scale.js": "export const scale = 1;\n",
          "node_modules/shapes/scale.d.ts": "export declare const scale: number;\n",
          ".sound/shapes/lay/area.js": annotate(area),
        });
        expect(await runProject(String(dir))).toMatchObject(usesTypedVersion);
      }),
    600_000,
  );

  test(
    "the text of a function of a typed version is the installed file's",
    () =>
      slot(async () => {
        const texts = "\nexport const texts = () => [area, texts, class Box { get() {} }].map(String);\n";
        const typedTexts =
          "\nexport const texts = (): string[] => [area, texts, class Box<T> { declare value: T; get(): void {} }].map(String);\n";
        const area = installed["area.js"] + texts;
        using dir = tempDir("aot-typed-packages", {
          ...project(manifest({ lay: { ...manifest().lay, "area.js": sha256(area) } })),
          "main.ts": 'import { texts } from "shapes/area.js";\nconsole.log(JSON.stringify(texts()));\n',
          "node_modules/shapes/area.js": area,
          "node_modules/shapes/area.d.ts": "export declare function texts(): string[];\n",
          ".sound/shapes/lay/area.js": typed["area.js"] + typedTexts,
        });
        expect(await runProject(String(dir))).toMatchObject({
          errors: [],
          notes: [USED],
          exitCode: 0,
          stdout:
            JSON.stringify([
              "function area(w, h) {\n  return w * h;\n}",
              "() => [area, texts, class Box { get() {} }].map(String)",
              "class Box { get() {} }",
            ]) + "\n",
        });
      }),
    600_000,
  );

  // Each line is an error under one of the options, and none under `strict`.
  const sides = "const sides = [2, 2];\nconst names = { w: 1 };\n";
  const leansOnStrictAlone = (text: string) =>
    sides.replace("[2, 2]", "[2, 2] as number[]").replace("{ w: 1 }", "{ w: 1 } as { [name: string]: number }") +
    annotate(text).replace("* 2", "* sides[0].valueOf() * names.w.valueOf() * [...sides][1].valueOf() / 2");
  const withSides = (text: string) =>
    sides + text.replace("* 2", "* sides[0].valueOf() * names.w.valueOf() * [...sides][1].valueOf() / 2");
  const stricterThanStrict = {
    noUncheckedIndexedAccess: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    verbatimModuleSyntax: true,
  };
  const withElementReads = (sound: object, compilerOptions: object): Files => ({
    ...project({
      ...manifest({ lay: { ...manifest().lay, "perimeter.js": sha256(withSides(installed["perimeter.js"])) } }),
      ...sound,
    }),
    "tsconfig.json": tsconfig(compilerOptions),
    "node_modules/shapes/perimeter.js": withSides(installed["perimeter.js"]),
    ".sound/shapes/lay/perimeter.js": leansOnStrictAlone(installed["perimeter.js"]),
  });

  test(
    "what the project asks of its own text beyond strict is not asked of a typed version",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", withElementReads({}, stricterThanStrict));
        expect(await runProject(String(dir))).toMatchObject(usesTypedVersion);
      }),
    600_000,
  );

  test(
    "a typed version is checked under the options that its sound.json states",
    () =>
      slot(async () => {
        const sound = { compilerOptions: { strict: true, noUncheckedIndexedAccess: true } };
        using dir = tempDir("aot-typed-packages", withElementReads(sound, {}));
        const result = await runProject(String(dir));
        expect(result.warnings).toEqual([
          expect.stringMatching(/^TS100009: 'shapes' has 3 type errors \(the first at /),
        ]);
        expect(result).toMatchObject({ errors: [], exitCode: 0 });
      }),
    600_000,
  );
});

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildFlags } from "../harness/flags";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

interface SourceMap {
  version: number;
  file: string;
  sources: string[];
  names: string[];
  mappings: string;
}

interface Frame {
  name: string;
  file: string;
  line: number;
  column: number;
}

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;
const executableName = (name: string) => (isWindows ? name + ".exe" : name);

const program = {
  "app.ts": `import { measure } from "./concealed-module";
function outermostCaller(depth: number): number {
  return measure(depth) + 1;
}
try {
  console.log(outermostCaller(process.argv.length));
} catch (error) {
  console.log((error as Error).stack);
}
`,
  "concealed-module.ts": `function innermostThrower(depth: number): number {
  if (depth > 0) throw new Error("too deep");
  return depth;
}
export function measure(depth: number): number {
  return innermostThrower(depth) * 2;
}
`,
};
const functionNames = ["innermostThrower", "measure", "outermostCaller"];
const concealedTexts = ["innermostThrower", "outermostCaller", "concealed-module"];

async function compile(folder: string, name: string, ...flags: string[]) {
  built(await spawned([bunExe(), "compile", "app.ts", "--outfile", name, ...flags], folder, env));
  return join(folder, executableName(name));
}

const readMap = (executable: string): SourceMap => JSON.parse(readFileSync(executable + ".map", "utf8"));

function textsIn(executable: string) {
  const file = readFileSync(executable);
  return concealedTexts.filter(text => file.includes(text) || file.includes(Buffer.from(text, "utf16le")));
}

function framesOf(stack: string): Frame[] {
  return stack.split("\n").flatMap(line => {
    const found = /^ +at (?:(.+) \()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/.exec(line);
    return found
      ? [
          {
            name: found[1] ?? "",
            file: basename(found[2]!),
            line: Number(found[3] ?? 1),
            column: Number(found[4] ?? 1),
          },
        ]
      : [];
  });
}

function decodeSegment(segment: string) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const fields: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = digits.indexOf(character);
    value |= (digit & 31) << shift;
    shift += 5;
    if (digit & 32) continue;
    fields.push(value & 1 ? -(value >> 1) : value >> 1);
    value = shift = 0;
  }
  return fields;
}

function decodeMappings({ sources, names, mappings }: SourceMap) {
  const frames = new Map<string, Frame>();
  let [source, line, column, name] = [0, 0, 0, 0];
  mappings.split(";").forEach((segments, generatedLine) => {
    let generatedColumn = 0;
    for (const segment of segments.split(",").filter(segment => segment !== "")) {
      const fields = decodeSegment(segment);
      generatedColumn += fields[0]!;
      if (fields.length < 4) continue;
      source += fields[1]!;
      line += fields[2]!;
      column += fields[3]!;
      name += fields[4] ?? 0;
      frames.set(`${generatedLine + 1}:${generatedColumn + 1}`, {
        name: fields.length > 4 ? names[name]! : "",
        file: basename(sources[source]!),
        line: line + 1,
        column: column + 1,
      });
    }
  });
  return frames;
}

const refusals: [compile: object, message: string][] = [
  [{ obfuscate: true }, "compile.obfuscate requires compile.aot: true"],
  [
    { trim: { locales: [""] } },
    'Invalid value for compile.trim.locales: "". Must be a list of locale tags, like en,de-AT',
  ],
  [{ trim: { locales: [1] } }, "compile.trim must be true, false or an object: { allow, remove, locales, log }"],
];

async function refusalOf(folder: string, compile: object) {
  try {
    await Bun.build({
      entrypoints: [join(folder, "app.ts")],
      compile: { outfile: join(folder, "refused"), ...compile },
    });
    return "built";
  } catch (error) {
    return (error as Error).message;
  }
}

describe.concurrent("--obfuscate", () => {
  // TODO: the file name of the imported module stays in the executable.
  test.todo(
    "function names and the file name of an imported module leave the executable",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-texts", program);
        const plain = await compile(String(dir), "plain");
        expect(textsIn(plain)).toEqual(concealedTexts);
        expect(existsSync(plain + ".map")).toBe(false);
        expect(textsIn(await compile(String(dir), "obfuscated", buildFlags.obfuscate))).toEqual([]);
      }),
    buildLimit,
  );

  test(
    "the map leads from the numbers in a stack to the names and positions that a build without the flag prints",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-stack", program);
        const folder = String(dir);
        const plain = await spawned([await compile(folder, "plain")], folder, env);
        const expected = framesOf(plain.stdout).slice(0, functionNames.length);
        expect(expected.map(frame => frame.name)).toEqual(functionNames);
        expect(expected.map(frame => frame.file)).toEqual(["concealed-module.ts", "concealed-module.ts", "app.ts"]);

        const executable = await compile(folder, "obfuscated", buildFlags.obfuscate);
        const obfuscated = await spawned([executable], folder, env);
        expect({ stderr: obfuscated.stderr, exitCode: obfuscated.exitCode }).toEqual({
          stderr: plain.stderr,
          exitCode: plain.exitCode,
        });
        expect(obfuscated.stdout).toStartWith("Error: too deep\n");
        expect(obfuscated.stdout).not.toMatch(/innermostThrower|measure|outermostCaller|concealed-module|app\.ts/);

        const map = readMap(executable);
        expect({ version: map.version, file: map.file }).toEqual({ version: 3, file: executableName("obfuscated") });
        const frames = decodeMappings(map);
        expect(
          framesOf(obfuscated.stdout)
            .slice(0, functionNames.length)
            .map(frame => frames.get(`${frame.line}:${frame.column}`)),
        ).toEqual(expected);
      }),
    buildLimit,
  );

  test(
    "the map of a relative --outfile in a directory is written beside the executable",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-outfile", program);
        const folder = String(dir);
        await compile(folder, "dist/app", buildFlags.obfuscate);
        expect(readdirSync(join(folder, "dist")).sort()).toEqual([
          executableName("app"),
          executableName("app") + ".map",
          executableName("app") + ".map.js",
        ]);
        expect(existsSync(join(folder, executableName("app") + ".map"))).toBe(false);
      }),
    buildLimit,
  );

  test(
    "--sourcemap=external builds what --obfuscate builds",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-sourcemap-external", program);
        const folder = String(dir);
        const obfuscated = await compile(folder, "first/app", buildFlags.obfuscate);
        const withMap = await compile(folder, "second/app", "--sourcemap=external");
        expect(readFileSync(withMap + ".map", "utf8")).toBe(readFileSync(obfuscated + ".map", "utf8"));
        expect(readFileSync(withMap).equals(readFileSync(obfuscated))).toBe(true);
      }),
    buildLimit,
  );

  test(
    "with --minify the map has the names as they are written",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-minify", program);
        const executable = await compile(String(dir), "app", "--minify", "--sourcemap=external");
        expect(readMap(executable).names).toEqual(expect.arrayContaining(functionNames));
      }),
    buildLimit,
  );

  test(
    "an uncaught error and console.trace print frames that the map resolves",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-uncaught", {
          "app.ts": `function outermostCaller(depth: number): number {
  console.trace("traced");
  if (depth > 0) throw new Error("too deep");
  return depth;
}
outermostCaller(process.argv.length);
`,
        });
        const folder = String(dir);
        const executable = await compile(folder, "app", buildFlags.obfuscate);
        const { stdout, stderr, exitCode } = await spawned([executable], folder, env);
        expect(exitCode).toBe(1);
        expect(stdout + stderr).not.toMatch(/outermostCaller|app\.ts/);
        const frames = decodeMappings(readMap(executable));
        expect(framesOf(stdout + stderr).map(frame => frames.get(`${frame.line}:${frame.column}`))).toEqual([
          { name: "outermostCaller", file: "app.ts", line: 2, column: 11 },
          { name: "", file: "app.ts", line: 6, column: 1 },
          { name: "outermostCaller", file: "app.ts", line: 3, column: 28 },
          { name: "", file: "app.ts", line: 6, column: 1 },
        ]);
      }),
    buildLimit,
  );

  test("--obfuscate requires --aot", async () => {
    using dir = tempDir("aot-obfuscate-without-aot", program);
    const { stdout, stderr, exitCode } = await spawned(
      [bunExe(), "build", "--compile", buildFlags.obfuscate, "app.ts", "--outfile", "app"],
      String(dir),
      env,
    );
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: "error: --obfuscate requires --aot\n",
      exitCode: 1,
    });
  });

  test.each(["--obfuscate", "--sourcemap=external"])("%s rejects --aot-symbols", async flag => {
    using dir = tempDir("aot-obfuscate-with-symbols", program);
    const { stdout, stderr, exitCode } = await spawned(
      [bunExe(), "build", "--compile", "--aot", flag, "--aot-symbols", "app.ts", "--outfile", "app"],
      String(dir),
      env,
    );
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr:
        "error: --aot-symbols: cannot be used with --obfuscate or --sourcemap=external, which keep function names out of the executable\n",
      exitCode: 1,
    });
  });

  test(
    "Bun.build writes the map for compile.obfuscate",
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-api", program);
        const outfile = join(String(dir), "api", "app");
        await Bun.build({
          entrypoints: [join(String(dir), "app.ts")],
          compile: { outfile, aot: true, obfuscate: true },
        });
        const map = readMap(executableName(outfile));
        expect({ version: map.version, file: map.file }).toEqual({ version: 3, file: executableName("app") });
        expect(map.sources.map(source => basename(source)).sort()).toEqual(
          expect.arrayContaining(["app.ts", "concealed-module.ts"]),
        );
        expect(map.names).toEqual(expect.arrayContaining(functionNames));
      }),
    buildLimit,
  );

  test(
    'Bun.build writes the map for sourcemap: "external"',
    () =>
      slot(async () => {
        using dir = tempDir("aot-obfuscate-api-sourcemap", program);
        const outfile = join(String(dir), "api", "app");
        await Bun.build({
          entrypoints: [join(String(dir), "app.ts")],
          sourcemap: "external",
          compile: { outfile, aot: true },
        });
        expect(readMap(executableName(outfile)).names).toEqual(expect.arrayContaining(functionNames));
      }),
    buildLimit,
  );

  test.each(refusals)("Bun.build rejects compile: %j", async (compile, message) => {
    using dir = tempDir("aot-obfuscate-refused", program);
    expect(await refusalOf(String(dir), compile)).toBe(message);
    expect(readdirSync(String(dir)).filter(name => name.startsWith("refused"))).toEqual([]);
  });
});

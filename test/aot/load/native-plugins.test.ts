import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { slot, spawned, unsupported } from "../harness/commands";

type Files = Record<string, string>;
type Environment = Record<string, string>;

const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const exe = (name: string) => name + (isWindows ? ".exe" : "");

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
if (!systemCC) {
  console.error(
    "SKIPPED: test/aot/load/native-plugins.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang",
  );
}

const PLUGIN = `#include <bun-native-bundler-plugin-api/bundler_plugin.h>
#include <node_api.h>
NAPI_MODULE_EXPORT const char *BUN_PLUGIN_NAME = "aot-native-plugin";
NAPI_MODULE_EXPORT void read_as_typescript(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  if (result->fetchSourceCode(args, result) != 0) return;
  result->loader = BUN_LOADER_TS;
}
NAPI_MODULE_INIT() { return exports; }
`;

const BUILD = `import plugins from "./plugins";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: process.argv[3] === "aot" }, plugins: plugins(require(process.env.ADDON!)), throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
  },
  files: ["main.ts"],
});

const pluginsFile = (...setup: string[]) =>
  `export default (napiModule: unknown) => [{ name: "p", setup(b: any) {\n${setup.join("\n")}\n} }];\n`;
const onBeforeParse = (filter: RegExp, symbol: string) =>
  `b.onBeforeParse({ filter: ${filter} }, { napiModule, symbol: "${symbol}" });`;

async function expectInModes(modes: string[], files: Files, output: string, env: Environment) {
  using dir = tempDir("aot-native-plugins", { "build.ts": BUILD, "tsconfig.json": TSCONFIG, ...files });
  const folder = String(dir);
  for (const mode of modes) {
    const program = join(folder, exe(mode));
    const built = await spawned([bunExe(), "build.ts", program, mode], folder, { ...bunEnv, ...env });
    expect({ mode, ...built }).toEqual({
      mode,
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    const ran = await spawned([program], folder, mode === "aot" ? COMPILED : bunEnv);
    expect({ mode, ...ran }).toEqual({ mode, stdout: output, stderr: expect.any(String), exitCode: 0, signal: null });
  }
}

// What else a native plugin does: ../build-plugins-native.test.ts.
const successes: [name: string, modes: string[], files: Files, output: string][] = [
  [
    "changes the loader",
    // No reference: `bun build` drops the loader a native plugin sets (get_source_code in src/bundler/ParseTask.rs).
    ["aot"],
    {
      "main.ts": '// @ts-ignore\nimport { twice } from "./lib.weird";\nconsole.log(twice(21));\n',
      "lib.weird": "export function twice(n: number): number {\n  return n * 2;\n}\n",
      "plugins.ts": pluginsFile(onBeforeParse(/\.weird$/, "read_as_typescript")),
    },
    "42\n",
  ],
];

describe.concurrent.skipIf(!systemCC || !!unsupported)("compile/aot/load/native-plugins", () => {
  const folder = String(tempDir("aot-native-plugins", { "plugin.c": PLUGIN }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ADDON: join(folder, "plugin.node") };

  beforeAll(async () => {
    const compiled = await spawned(
      [
        systemCC!,
        "-shared",
        ...(isWindows ? [] : ["-fPIC"]),
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../../src/runtime/napi"),
        "-I" + resolve(import.meta.dir, "../../../packages"),
        "plugin.c",
        "-o",
        "plugin.node",
      ],
      folder,
      bunEnv,
    );
    expect(compiled).toEqual({ stdout: expect.any(String), stderr: expect.any(String), exitCode: 0, signal: null });
  }, 120_000);

  test.each(successes)(
    "%s",
    (_, modes, files, output) => slot(() => expectInModes(modes, files, output, env)),
    600_000,
  );
});

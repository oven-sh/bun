import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { slot, spawned, unsupported } from "../run-programs";

type Files = Record<string, string>;
type Environment = Record<string, string>;

const MODES = ["bundle", "aot"];
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
#include <stdlib.h>
#include <string.h>
NAPI_MODULE_EXPORT const char *BUN_PLUGIN_NAME = "aot-native-plugin";
NAPI_MODULE_EXPORT void replace_text(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  if (result->fetchSourceCode(args, result) != 0) return;
  char *text = malloc(result->source_len + 1);
  memcpy(text, result->source_ptr, result->source_len);
  for (size_t i = 0; i + 6 <= result->source_len; i++)
    if (memcmp(text + i, "before", 6) == 0) memcpy(text + i, "after!", 6);
  result->source_ptr = (uint8_t *)text;
  result->plugin_source_code_context = text;
  result->free_plugin_source_code_context = free;
}
NAPI_MODULE_EXPORT void read_as_typescript(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  if (result->fetchSourceCode(args, result) != 0) return;
  result->loader = BUN_LOADER_TS;
}
NAPI_MODULE_EXPORT void report_error(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  static const char message[] = "the native plugin gave up";
  BunLogOptions options = { sizeof(BunLogOptions), (const uint8_t *)message, sizeof(message) - 1, args->path_ptr, args->path_len, NULL, 0, BUN_LOG_LEVEL_ERROR, 0, 0, 0, 0 };
  result->log(args, &options);
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

async function expectFailureInBothModes(files: Files, message: string, env: Environment) {
  using dir = tempDir("aot-native-plugins", { "build.ts": BUILD, "tsconfig.json": TSCONFIG, ...files });
  const folder = String(dir);
  for (const mode of MODES) {
    const program = join(folder, exe(mode));
    const built = await spawned([bunExe(), "build.ts", program, mode], folder, { ...bunEnv, ...env });
    expect({ mode, ...built, wrote: existsSync(program) }).toEqual({
      mode,
      stdout: expect.stringContaining(message),
      stderr: expect.any(String),
      exitCode: 1,
      signal: null,
      wrote: false,
    });
  }
}

const textProgram: Files = { "main.ts": 'console.log("before");\n' };

const successes: [name: string, modes: string[], files: Files, output: string][] = [
  [
    "changes the text",
    MODES,
    { ...textProgram, "plugins.ts": pluginsFile(onBeforeParse(/main\.ts$/, "replace_text")) },
    "after!\n",
  ],
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
  [
    "is not run over the text that a JS onLoad yields",
    MODES,
    {
      "main.ts": 'import { word } from "./lib";\nconsole.log(word);\n',
      "lib.ts": 'export const word: string = "on disk";\n',
      "plugins.ts": pluginsFile(
        `b.onLoad({ filter: ${/lib\.ts$/} }, () => ({ contents: 'export const word: string = "before";', loader: "ts" }));`,
        onBeforeParse(/lib\.ts$/, "replace_text"),
      ),
    },
    "before\n",
  ],
  [
    "non-matching filter",
    MODES,
    { ...textProgram, "plugins.ts": pluginsFile(onBeforeParse(/other\.ts$/, "replace_text")) },
    "before\n",
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

  test(
    "reported error fails the build",
    () =>
      slot(() =>
        expectFailureInBothModes(
          { ...textProgram, "plugins.ts": pluginsFile(onBeforeParse(/main\.ts$/, "report_error")) },
          "the native plugin gave up",
          env,
        ),
      ),
    600_000,
  );
});

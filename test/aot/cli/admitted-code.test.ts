// Some options make an executable load code that wasn't compiled into it when it starts: --preload and the like, and the debugger.
// An executable only runs code that was compiled into it, so it rejects the first kind when it starts, and a build rejects it in
// --compile-exec-argv. What the bunfig.toml of the working directory would load is ignored. A build with --compile-inspector, or with --inspect in --compile-exec-argv, takes both kinds, unless it has
// --no-compile-function-source or --obfuscate.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const before = `(globalThis as any).loaded = "preloaded";\nconsole.log("before");\n`;
const files = {
  "entry.ts": `console.log("ran", (globalThis as any).loaded ?? "nothing loaded");\n`,
  "before.ts": before,
  "configured/before.ts": before,
  "configured/bunfig.toml": `preload = ["./before.ts"]\n`,
  "with-server-plugins/bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "with-server-plugins/plugin.ts": `export default { name: "nothing", setup() {} };\n`,
  "api.ts": `await Bun.build({ entrypoints: ["entry.ts"], compile: { outfile: "by-api-without-function-source", aot: true, functionSource: false } });
await Bun.build({ entrypoints: ["entry.ts"], compile: { outfile: "by-api-with-inspector", aot: true, inspector: true } });
`,
  "api-error.ts": `try {
  await Bun.build({ entrypoints: ["entry.ts"], compile: { outfile: "rejected", ...JSON.parse(process.argv[2]) } });
  console.log("built");
} catch (error) {
  console.log((error as Error).message);
}
`,
};

const builds: Record<string, string[]> = {
  "default": ["--aot"],
  "without-function-source": ["--aot", "--no-compile-function-source"],
  "obfuscated": ["--aot", "--obfuscate"],
  "with-inspector": ["--aot", "--compile-inspector"],
  "with-inspector-without-function-source": ["--aot", "--compile-inspector", "--no-compile-function-source"],
  "embeds-inspect": ["--aot", "--compile-exec-argv=--inspect=127.0.0.1:0"],
  "not-compiled": [],
};

let folder = "";
afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const build = (name: string, flags: string[]) =>
  spawned(
    [bunExe(), "build", "--compile", ...withoutDebugInformation(), ...flags, "entry.ts", "--outfile", name],
    folder,
    bunEnv,
  );
const started = (name: string, env: Record<string, string> = {}, cwd = folder, args: string[] = []) =>
  spawned([join(folder, isWindows ? name + ".exe" : name), ...args], cwd, { ...bunEnv, ...env });

const rejected = (option: string, reason: string) => ({
  stdout: "",
  stderr: `error: ${option} can't be used with this executable${reason}\n`,
  exitCode: 1,
  signal: null,
});
const needsFunctionSource = (option: string) =>
  rejected(
    option,
    " because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag",
  );
const runsOnlyCompiledCode = (option: string) =>
  rejected(
    option,
    " because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code",
  );
const needsInspector = (option: string) => rejected(option, ". Rebuild it with --compile-inspector");
const alone = { stdout: "ran nothing loaded\n", stderr: "", exitCode: 0, signal: null };
const preloaded = { stdout: "before\nran preloaded\n", stderr: "", exitCode: 0, signal: null };

beforeAll(async () => {
  folder = String(tempDir("aot-options-that-load-code", files));
  for (const [name, flags] of Object.entries(builds)) {
    built(await build(name, flags));
  }
  built(await spawned([bunExe(), "api.ts"], folder, bunEnv));
}, 600_000);

const preloads = ["--preload ./before.ts", "-r ./before.ts", "--require ./before.ts", "--import ./before.ts"];
const loadCode = [
  ["--preload", "--preload ./before.ts"],
  ["--preload", "--preload=./before.ts"],
  ["--preload", "-r ./before.ts"],
  ["--require", "--require ./before.ts"],
  ["--import", "--import ./before.ts"],
  ["--import", "--smol --title=-r --import ./before.ts"],
  ["--eval", "--eval 1"],
  ["--eval", "-e 1"],
  ["--print", "--print 1"],
  ["--print", "-p 1"],
  ["--hot", "--hot"],
  ["--watch", "--watch"],
];
const startTheDebugger = [
  ["--inspect", "--inspect"],
  ["--inspect", "--inspect=127.0.0.1:0"],
  ["--inspect-wait", "--inspect-wait=127.0.0.1:0"],
  ["--inspect-brk", "--smol --inspect-brk=127.0.0.1:0"],
];

describe.each([
  "without-function-source",
  "obfuscated",
  "with-inspector-without-function-source",
  "by-api-without-function-source",
])("%s: code that is loaded when the executable starts", name => {
  test.each(loadCode)("rejects %s in BUN_OPTIONS=%j", async (option, options) => {
    expect(await started(name, { BUN_OPTIONS: options })).toEqual(needsFunctionSource(option));
  });

  test("rejects the preload of a bunfig.toml", async () => {
    expect(await started(name, {}, join(folder, "configured"))).toEqual(
      needsFunctionSource(`"preload" in bunfig.toml`),
    );
  });

  test("rejects the plugins that a bunfig.toml passes to servers", async () => {
    expect(await started(name, {}, join(folder, "with-server-plugins"))).toEqual(
      needsFunctionSource(`"serve.static.plugins" in bunfig.toml`),
    );
  });

  test("rejects BUN_INSPECT_PRELOAD where it reads it", async () => {
    const env = { BUN_OPTIONS: "--smol", BUN_INSPECT_PRELOAD: "./before.ts" };
    expect(await started(name, env)).toEqual(needsFunctionSource("BUN_INSPECT_PRELOAD"));
  });

  test("runs alone where no option is passed", async () => {
    expect(await started(name)).toEqual(alone);
  });

  test("leaves what follows its name to the program", async () => {
    const args = [...loadCode, ...startTheDebugger].flatMap(([, options]) => options.split(" "));
    expect(await started(name, {}, folder, args)).toEqual(alone);
  });
});

describe.each(["default", "without-function-source", "obfuscated", "by-api-without-function-source"])(
  "%s: the debugger",
  name => {
    test.each(startTheDebugger)("rejects %s in BUN_OPTIONS=%j", async (option, options) => {
      expect(await started(name, { BUN_OPTIONS: options })).toEqual(needsInspector(option));
    });

    test("rejects BUN_INSPECT", async () => {
      expect(await started(name, { BUN_INSPECT: "ws://127.0.0.1:0/own" })).toEqual(needsInspector("BUN_INSPECT"));
    });

    test("ignores BUN_INSPECT_CONNECT_TO, which editors set for every process in their terminals", async () => {
      expect(await started(name, { BUN_INSPECT_CONNECT_TO: "unix:///nobody-listens-here.sock" })).toEqual(alone);
    });
  },
);

describe("a default build", () => {
  test("runs", async () => {
    expect(await started("default")).toEqual(alone);
  });

  test.each(["--smol", "--title=own", "--no-deprecation", "--console-depth=1 --expose-gc", "--title --preload"])(
    "obeys an option that loads no code: %s",
    async options => {
      expect(await started("default", { BUN_OPTIONS: options })).toEqual(alone);
    },
  );

  test("leaves what follows its name to the program", async () => {
    const args = [...loadCode, ...startTheDebugger].flatMap(([, options]) => options.split(" "));
    expect(await started("default", {}, folder, args)).toEqual(alone);
  });

  test.each(loadCode)("rejects %s in BUN_OPTIONS=%j", async (option, options) => {
    expect(await started("default", { BUN_OPTIONS: options })).toEqual(runsOnlyCompiledCode(option));
  });

  test("ignores the preload of the bunfig.toml that it finds where it is started: the file may be there for bun", async () => {
    expect(await started("default", {}, join(folder, "configured"))).toEqual(alone);
  });

  test("ignores the plugins that a bunfig.toml passes to servers: its pages were bundled by the build", async () => {
    expect(await started("default", {}, join(folder, "with-server-plugins"))).toEqual(alone);
  });

  test("rejects BUN_INSPECT_PRELOAD where it reads it", async () => {
    const env = { BUN_OPTIONS: "--smol", BUN_INSPECT_PRELOAD: "./before.ts" };
    expect(await started("default", env)).toEqual(runsOnlyCompiledCode("BUN_INSPECT_PRELOAD"));
  });
});

describe.each(["with-inspector", "by-api-with-inspector"])("%s", name => {
  test.each(preloads)("loads the file in BUN_OPTIONS=%j before the program", async options => {
    expect(await started(name, { BUN_OPTIONS: options })).toEqual(preloaded);
  });

  test("loads the preload of a bunfig.toml", async () => {
    expect(await started(name, {}, join(folder, "configured"))).toEqual(preloaded);
  });

  test("accepts the plugins that a bunfig.toml passes to servers", async () => {
    expect(await started(name, {}, join(folder, "with-server-plugins"))).toEqual(alone);
  });

  test("runs alone where no option is passed", async () => {
    expect(await started(name)).toEqual(alone);
  });
});

describe.each(["with-inspector", "with-inspector-without-function-source", "by-api-with-inspector"])("%s", name => {
  test("accepts BUN_INSPECT and runs the program", async () => {
    const { stdout, stderr, exitCode } = await started(name, { BUN_INSPECT: "ws://127.0.0.1:0/own" });
    expect(stderr).not.toContain("can't be used");
    expect({ stdout, exitCode }).toEqual({ stdout: alone.stdout, exitCode: 0 });
  });
});

test("--inspect in --compile-exec-argv is part of the build: it needs no --compile-inspector", async () => {
  const { stdout, stderr, exitCode } = await started("embeds-inspect");
  expect(stderr).not.toContain("can't be used");
  expect({ stdout, exitCode }).toEqual({ stdout: alone.stdout, exitCode: 0 });
});

test("an executable that was not compiled ahead of time loads what it is told to", async () => {
  expect(await started("not-compiled", { BUN_OPTIONS: "--preload ./before.ts" })).toEqual(preloaded);
  expect(await started("not-compiled", {}, join(folder, "configured"))).toEqual(preloaded);
});

describe("the build", () => {
  const onlyRunsCompiledCode = "because the executable only runs code that was compiled into it";

  test("rejects --compile-inspector without --aot", async () => {
    const { stderr, exitCode } = await build("rejected", ["--compile-inspector"]);
    expect(stderr).toContain("error: --compile-inspector requires --aot\n");
    expect(exitCode).toBe(1);
  });

  test.each([
    ["--no-compile-function-source", "--preload ./before.ts", "--preload"],
    ["--no-compile-function-source", "-r ./before.ts", "--preload"],
    ["--no-compile-function-source", "--smol --import ./before.ts", "--import"],
    ["--no-compile-function-source", "-e 1", "--eval"],
    ["--obfuscate", "--preload ./before.ts", "--preload"],
  ])("%s rejects --compile-exec-argv=%j", async (flag, execArgv, option) => {
    const { stderr, exitCode } = await build("rejected", ["--aot", flag, "--compile-exec-argv=" + execArgv]);
    expect(stderr).toContain(
      `error: ${flag} does not support ${option} in --compile-exec-argv ${onlyRunsCompiledCode}\n`,
    );
    expect(exitCode).toBe(1);
  });

  test.each([
    ["--preload ./before.ts", "--preload"],
    ["-e 1", "--eval"],
  ])("--aot alone rejects --compile-exec-argv=%j", async (execArgv, option) => {
    const { stderr, exitCode } = await build("rejected", ["--aot", "--compile-exec-argv=" + execArgv]);
    expect(stderr).toContain(
      `error: --aot does not support ${option} in --compile-exec-argv ${onlyRunsCompiledCode}\n`,
    );
    expect(exitCode).toBe(1);
  });

  test("--compile-inspector takes --preload in --compile-exec-argv", async () => {
    built(await build("embeds-preload", ["--aot", "--compile-inspector", "--compile-exec-argv=--preload ./before.ts"]));
    expect(await started("embeds-preload")).toEqual(preloaded);
  });

  test("--no-compile-function-source is the flag in the message where --obfuscate is passed too", async () => {
    const flags = ["--aot", "--obfuscate", "--no-compile-function-source", "--compile-exec-argv=--preload ./before.ts"];
    const { stderr, exitCode } = await build("rejected", flags);
    expect(stderr).toContain(
      `error: --no-compile-function-source does not support --preload in --compile-exec-argv ${onlyRunsCompiledCode}\n`,
    );
    expect(exitCode).toBe(1);
  });

  test.each([
    [{ inspector: true }, "compile.inspector requires compile.aot: true"],
    [
      { aot: true, functionSource: false, execArgv: ["--preload", "./before.ts"] },
      `compile.functionSource: false does not support --preload in compile.execArgv ${onlyRunsCompiledCode}`,
    ],
    [
      { aot: true, execArgv: ["--preload", "./before.ts"] },
      `compile.aot does not support --preload in compile.execArgv ${onlyRunsCompiledCode}`,
    ],
    [
      { aot: true, obfuscate: true, execArgv: ["--preload", "./before.ts"] },
      `compile.obfuscate does not support --preload in compile.execArgv ${onlyRunsCompiledCode}`,
    ],
  ])("Bun.build rejects compile: %j", async (compile, message) => {
    const { stdout, exitCode } = await spawned([bunExe(), "api-error.ts", JSON.stringify(compile)], folder, bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: message + "\n", exitCode: 0 });
  });
});

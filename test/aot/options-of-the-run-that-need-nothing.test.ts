// BUN_OPTIONS is often set for `bun` itself, and every executable that starts in that environment reads it too. An option that means nothing to an executable must not stop it.
// Options that load code are refused. compile-trim-bun-options.test.ts has every option.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, model } from "../bundler/compile-trim-features";
import "./harness/real-executables";
import { run } from "./harness/run";
import { test } from "./supported";
import { readRemovedFeatures, sayFeaturesAreRemoved } from "./trimmed-against-whole/removed-features";

const taken = [
  "--install=disable",
  "--install disable",
  "'--install=disable'",
  "--install=disable --install=disable",
  "--install=auto",
  "--install auto",
  "--install=auto --install=disable",
  "--smol --install=disable --title=x",
  "--no-install --install=disable",
  "--check",
  "--aot",
  "--check --aot --install=disable",
];

const loadsCode =
  "can't be used with this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code";
const refused: Record<string, string> = {
  "--preload=./preloaded.ts": `--preload ${loadsCode}`,
  "--install=disable --preload=./preloaded.ts": `--preload ${loadsCode}`,
  "--import=./preloaded.ts --check": `--import ${loadsCode}`,
  "--aot -e=1": `--eval ${loadsCode}`,
  "--install=disable --inspect": "--inspect can't be used with this executable. Rebuild it with --compile-inspector",
};
const noCommandLine =
  "can't be used with this executable because it doesn't include the Bun command line. Run bun instead";
const refusedWithoutTheCommandLine: Record<string, string> = {
  "--install=force": `--install ${noCommandLine}`,
  "--install=fallback": `--install ${noCommandLine}`,
  "--install=": `--install ${noCommandLine}`,
  "--install=disable --install=force": `--install ${noCommandLine}`,
  "--install=force --install=disable": `--install ${noCommandLine}`,
  "--install=auto --install=fallback": `--install ${noCommandLine}`,
  "-i": `-i ${noCommandLine}`,
  "--install=disable -i": `-i ${noCommandLine}`,
  "--aot --aot-allow-code-from-disk": `--aot-allow-code-from-disk ${noCommandLine}`,
  "--check --help": `--help ${noCommandLine}`,
};

const commandLine = model.features.filter(feature => feature.enteredFrom === "command-line").map(each => each.index);

async function built(folder: string, name: string, ...flags: string[]) {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", ...flags, "main.ts", "--outfile", executable],
    folder,
  );
  expect(stderr).not.toMatch(/^error\b/m);
  expect(exitCode).toBe(0);
  return executable;
}

test("an option in BUN_OPTIONS that an executable has no use for is taken, with --aot as without", async () => {
  using dir = tempDir("aot-options-of-the-run", {
    "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
    "main.ts": `console.log(JSON.stringify([process.execArgv, process.argv.slice(2), Bun.argv.slice(2)]));`,
    "preloaded.ts": `console.log("preloaded");`,
  });
  const folder = String(dir);
  const [plain, compiled] = await Promise.all([built(folder, "plain"), built(folder, "compiled", "--aot")]);
  if (!canTrim && isLinux) sayFeaturesAreRemoved(compiled, commandLine);
  const lacksTheCommandLine = canTrim || isLinux;
  if (lacksTheCommandLine) expect(readRemovedFeatures(compiled)).toEqual(expect.arrayContaining(commandLine));

  const startedWith = (executable: string, options: string, ...args: string[]) =>
    run([executable, ...args], folder, { ...bunEnv, BUN_OPTIONS: options });
  for (const options of taken) {
    const wanted = await startedWith(plain, options, "word", "--install=force");
    expect(wanted).toMatchObject({ stderr: "", exitCode: 0 });
    expect({ options, ...(await startedWith(compiled, options, "word", "--install=force")) }).toEqual({
      options,
      ...wanted,
    });
  }

  const unknown = "--install=nonsense";
  const complaint = await startedWith(plain, unknown);
  expect(complaint).toMatchObject({ stdout: "", exitCode: 1 });
  expect(complaint.stderr).toStartWith(`error: Invalid value for --install: "nonsense".`);
  expect(await startedWith(compiled, unknown)).toEqual(complaint);

  for (const [options, message] of Object.entries({
    ...refused,
    ...(lacksTheCommandLine && refusedWithoutTheCommandLine),
  })) {
    expect({ options, ...(await startedWith(compiled, options)) }).toEqual({
      options,
      stdout: "",
      stderr: `error: ${message}\n`,
      exitCode: 1,
    });
  }
}, 240_000);

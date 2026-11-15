// `require.resolve("/etc/app/config.json")`: a whole path, written out, to a file that was not there at the build. The executable looks for the file when it
// runs, as `bun <file>` does: it throws where there is none and returns the path where there is one. Each case prints what `bun <the main file>` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const attempt = (text: string) =>
  `let got;\ntry {\n  got = ${text};\n} catch (error) {\n  got = error.code;\n}\nconsole.log(got);\n`;

type Case = {
  main: string;
  text: (at: (name: string) => string) => string;
  prints: (folder: string) => string;
  laidBehindBuild?: string;
};
const cases: Record<string, Case> = {
  "data that never was": {
    main: "main.cjs",
    text: at => attempt(`require.resolve(${at("never.json")})`),
    prints: () => "MODULE_NOT_FOUND\n",
  },
  "code that never was": {
    main: "main.cjs",
    text: at => attempt(`require.resolve(${at("never.js")})`),
    prints: () => "MODULE_NOT_FOUND\n",
  },
  "the free require of an ES module": {
    main: "main.mjs",
    text: at => attempt(`require.resolve(${at("never.json")})`),
    prints: () => "MODULE_NOT_FOUND\n",
  },
  "the error": {
    main: "main.cjs",
    text: at =>
      `try {\n  require.resolve(${at("never.json")});\n} catch (error) {\n  console.log(error.name, error.message.split("'")[0]);\n}\n`,
    prints: () => "ResolveMessage Cannot find module \n",
  },
  "data that the program writes first": {
    main: "main.cjs",
    text: at =>
      `require("node:fs").writeFileSync(${at("written.json")}, "{}");\n${attempt(`require.resolve(${at("written.json")})`)}`,
    prints: folder => `${join(folder, "written.json")}\n`,
  },
  "data that is laid behind the build": {
    main: "main.cjs",
    text: at => attempt(`require.resolve(${at("laid.json")})`),
    prints: folder => `${join(folder, "laid.json")}\n`,
    laidBehindBuild: "laid.json",
  },
  "names that the host answers": {
    main: "main.cjs",
    text: () =>
      attempt(
        `[require.resolve("bun"), require.resolve("node:fs"), require.resolve("fs"), require.resolve("bun:sqlite")].join()`,
      ),
    prints: () => "bun,node:fs,fs,bun:sqlite\n",
  },
  "an address is made and nothing is looked for": {
    main: "main.mjs",
    text: at => attempt(`import.meta.resolve(${at("never.json")}) === Bun.pathToFileURL(${at("never.json")}).href`),
    prints: () => "true\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, text, prints, laidBehindBuild } = cases[name];
  using outside = tempDir("aot-a-written-whole-path-outside", {});
  const at = (file: string) => JSON.stringify(join(String(outside), file));
  using sources = tempDir("aot-a-written-whole-path", { [main]: text(at) });
  using elsewhere = tempDir("aot-a-written-whole-path-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", main, "--outfile", executable], String(sources));
  expect(built.exitCode).toBe(0);
  if (laidBehindBuild) await Bun.write(join(String(outside), laidBehindBuild), "{}");
  const plain = await run([bunExe(), main], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints(String(outside)), exitCode: 0 });
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: prints(String(outside)),
    exitCode: 0,
  });
});

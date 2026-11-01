import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, featureNamed, saysFeatureWasRemoved, withoutFeatures } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/commands";
import { run } from "./harness/run";
import { withoutDebugInformation } from "./harness/without-debug-information";

// A build of Bun that cannot trim compiles the program all the same, and says so only when it comes to the executable.
test.skipIf(!!unsupported)(
  "match() with a literal that is not global compiles without regular expressions, and runs until it gets there",
  async () => {
    using dir = tempDir("match-on-a-literal-without-regular-expressions", {
      "program.ts": `function versionIn(value: unknown) {
  return String(value).match(/(?<=bun )\\S+/)?.[0];
}
console.log(process.argv.length > 2 ? versionIn(process.argv[2]) : "no text");
`,
    });
    const folder = String(dir);
    const regExp = featureNamed("RegExp");
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        ...withoutDebugInformation,
        "--aot",
        "--aot-verify-each-pass",
        "--trim",
        ...withoutFeatures([regExp]),
        "program.ts",
        "--outfile",
        "program",
      ],
      folder,
    );
    if (!canTrim) {
      expect(built.stderr.match(/^error\b.*$/gm)).toEqual([
        expect.stringContaining("this build of Bun doesn't support --trim"),
      ]);
      return;
    }
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);

    const program = join(folder, "program");
    expect(await run([program], folder)).toEqual({ stdout: "no text\n", stderr: "", exitCode: 0 });
    const stopped = await run([program, "bun 1.4.3 on linux"], folder);
    expect(saysFeatureWasRemoved(stopped.stderr, regExp)).toBe(true);
    expect({ stdout: stopped.stdout, exitCode: stopped.exitCode }).toEqual({ stdout: "", exitCode: 70 });
  },
);

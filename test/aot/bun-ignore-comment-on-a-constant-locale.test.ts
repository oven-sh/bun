// TS100203 warns of a constant locale that --trim-locales leaves out. The compiler's engine keeps one place for each locale, so the warning
// stands for every call that passes the locale, and a comment on one line can't silence it. The build says so, whatever its list is.
// What the build warns of under a list is in test/bundler/compile-trim-locales.test.ts: only a Bun that can trim shows it.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a comment can't silence the warning about a locale that a list leaves out", async () => {
  const text = `console.log(new Intl.NumberFormat("de-DE").format(1)); // bun-ignore TS100203\n`;
  using dir = tempDir("bun-ignore-locale", { "main.cjs": text });
  using out = tempDir("bun-ignore-locale-out", {});
  const cmd = [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", join(String(out), "program")];
  const { stderr, exitCode } = await run(cmd, String(dir));
  expect({ said: stderr.match(/^(warn|error): TS\d+.*/gm) ?? [], exitCode }).toEqual({
    said: ["warn: TS100073: This comment silences nothing: TS100203 can't be silenced"],
    exitCode: 0,
  });
});

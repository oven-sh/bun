// TS100087 warns where a program passes a constant locale that --trim-locales leaves out. Whether the list leaves it out is decided
// behind the compiler, by the build that has the list, so a `bun-ignore` comment for it is judged by its line alone: where a
// constant locale stands it silences something, whatever this build's list is. The list of another build may leave the locale out.
// What the comment silences under a list is in test/bundler/compile-trim-locales.test.ts: only a Bun that can trim shows it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function build(text: string) {
  using dir = tempDir("bun-ignore-locale", { "main.cjs": text });
  using out = tempDir("bun-ignore-locale-out", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", join(String(out), "program")],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { said: stderr.match(/^(warn|error): TS\d+.*/gm) ?? [], exitCode };
}

test("a comment on a constant locale silences something where no list leaves the locale out", async () => {
  const text = `console.log(new Intl.NumberFormat("de-DE").format(1)); // bun-ignore TS100087\n`;
  expect(await build(text)).toEqual({ said: [], exitCode: 0 });
});

test("a comment for a locale silences nothing where the line passes no constant locale", async () => {
  const text = `console.log(new Intl.NumberFormat(process.argv[2]).format(1)); // bun-ignore TS100087\n`;
  expect(await build(text)).toEqual({
    said: [
      "warn: TS100073: This comment silences nothing: the build reports no TS100087 on the line that it applies to",
    ],
    exitCode: 0,
  });
});

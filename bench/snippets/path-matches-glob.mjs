// @runtime node, bun
import { posix, win32 } from "node:path";
import { bench, group, run } from "../runner.mjs";

const inputs = {
  "ascii": "src",
  "utf-16": "プロジェクト/usér",
  "2000+ chars": "modules/@scope/package-name/dist/esm/".repeat(55) + "src",
};

for (const [name, dir] of Object.entries(inputs)) {
  const slash = `${dir}/*.js`;
  const backslash = slash.replaceAll("/", "\\");
  const file = `${dir}/index.js`;
  const winFile = file.replaceAll("/", "\\");

  group(`one pattern, ${name}`, () => {
    bench(`posix, ${name}`, () => posix.matchesGlob(file, slash));
    bench(`win32, / pattern, ${name}`, () => win32.matchesGlob(winFile, slash));
    bench(`win32, \\ pattern, ${name}`, () => win32.matchesGlob(winFile, backslash));
  });
}

group("patterns and flavours in turn", () => {
  const patterns = ["src/*.js", "src/*.ts", "lib/*.js", "lib/*.ts", "test/*.js"];
  const file = "src/index.js";
  const winFile = "src\\index.js";
  let i = 0;

  bench("posix, two patterns", () => posix.matchesGlob(file, patterns[i++ & 1]));
  bench("posix, five patterns", () => posix.matchesGlob(file, patterns[i++ % 5]));
  bench("posix and win32, one pattern", () => (i++ & 1 ? win32 : posix).matchesGlob(file, patterns[0]));
  bench("posix and win32, a pattern each", () =>
    i++ & 1 ? win32.matchesGlob(winFile, patterns[1]) : posix.matchesGlob(file, patterns[0]),
  );
  bench("posix then win32 for each of five patterns", () => {
    const pattern = patterns[i++ % 5];
    return posix.matchesGlob(file, pattern) === win32.matchesGlob(winFile, pattern);
  });
  bench("win32, \\ and / spellings of one pattern", () =>
    win32.matchesGlob(winFile, i++ & 1 ? "src/*.js" : "src\\*.js"),
  );
});

await run();

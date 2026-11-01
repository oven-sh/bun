// One program for each crash or wrong answer of ordinary code that was fixed, held to what plain Bun prints.
// They lie in fixed.txt, which no formatter rewrites: a line "#### path" begins a file, and the first file of a name is where that program starts.
import { expect } from "bun:test";
import { bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { separatePrograms } from "./harness/separate-programs";
import { test } from "./supported";

const programs = new Map<string, Record<string, string>>();
for (const file of readFileSync(join(import.meta.dir, "fixed.txt"), "utf8")
  .split(/^#### /m)
  .slice(1)) {
  const end = file.indexOf("\n");
  const path = file.slice(0, end);
  const name = path.split("/")[0];
  if (!programs.has(name)) programs.set(name, {});
  programs.get(name)![path] = file.slice(end + 1);
}
const entryOf = (name: string) => Object.keys(programs.get(name)!)[0];

// Each is compiled as it is when it is built alone. A build of more entry points than MaxProgramsPerBuild joins them into one program, where one hides the fault of another.
const inOneBuild = 25;
const names = [...programs.keys()];
for (let first = 0; first < names.length; first += inOneBuild) {
  const together = names.slice(first, first + inOneBuild);
  const files = Object.assign({}, ...together.map(name => programs.get(name)));
  const { folder, start } = separatePrograms("fixed", files, together.map(entryOf));
  test.skipIf(!!without("a canary")).concurrent.each(together)(
    "%s",
    async name => {
      const [plain, compiled] = await Promise.all([
        run([bunExe(), "run", "./" + entryOf(name)], folder),
        start(entryOf(name)),
      ]);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: plain.stdout,
        exitCode: plain.exitCode,
      });
    },
    240_000,
  );
}

// Would a fault in the compiler change what a small program answers? ./programs-that-notice-a-sabotage.ts names, for a fault that is made on purpose, programs that run in
// the shell of the engine. Built with the fault one of them fails: it answers something else, it ends by itself, or the build stops. Built without, each passes:
// ./ir-1.test.ts to ./ir-6.test.ts run them all as they are, and here the ones that are built with more option words run once more with those alone.
//   testaot run <file> --option=sabotage=<name> --show-output
import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../harness/commands";
import { test } from "../harness/declare";
import { noticedInTheShell } from "./programs-that-notice-a-sabotage";
import { engineTests, run, whyNoNativeTests } from "./testaot";

const roots = [engineTests ?? "", join(import.meta.dir, "..", "engine-tests")];

test.skipIf(!!whyNoNativeTests).concurrent.each(Object.keys(noticedInTheShell))(
  "%s",
  async name => {
    let noticedBy: string | undefined;
    for (const program of noticedInTheShell[name]) {
      const [path, ...words] = [program].flat();
      const file = roots.map(root => join(root, path)).find(existsSync);
      expect({ path, isThere: file !== undefined }).toEqual({ path, isThere: true });
      const options = words.map(word => `--option=${word}`);
      const { lines } = await slot(() => run("run", file!, ...options, `--option=sabotage=${name}`));
      expect(lines.filter(line => line.includes(": unknown sabotage "))).toEqual([]);
      // Where the build itself stops there is no last line.
      if (lines.at(-1) === "1 passed, 0 failed, 0 todo") continue;
      if (words.length)
        expect({ path, control: (await slot(() => run("run", file!, ...options))).lines.at(-1) }).toEqual({
          path,
          control: "1 passed, 0 failed, 0 todo",
        });
      noticedBy = path;
      break;
    }
    expect({ name, isNoticed: noticedBy !== undefined }).toEqual({ name, isNoticed: true });
  },
  240_000,
);

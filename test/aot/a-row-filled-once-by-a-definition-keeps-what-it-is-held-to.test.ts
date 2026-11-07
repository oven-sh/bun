// The program is one of ./parallel: what it prints is held to plain Bun there. Here the plan of its slots is asked.
// Two constructors lay `works`, and a function reads it through a receiver that is the one or the other, so both rows lie at one offset.
// Clock lays it by a data descriptor, read-only and not configurable: that row is filled once, by a definition, and is held to what is seen defined.
// Sundial stores whatever it is handed: its row takes every value. The one row keeps what it is held to beside the other.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot, whyNoTestaot } from "./engine/testaot";
import { run } from "./harness/run";
import { test } from "./supported";

const program = join(
  import.meta.dir,
  "parallel/slots-held-for-fields-laid-by-data-descriptors/two-layouts-share-the-place-and-one-takes-every-value.js",
);

test.skipIf(whyNoTestaot !== undefined)(
  "a row that is filled once by a definition keeps what it is held to beside a row that takes every value",
  async () => {
    using dir = tempDir("aot-a-row-filled-once-by-a-definition", {});
    const cwd = String(dir);
    const [executable, wire] = [join(cwd, "main.exe"), join(cwd, "main.wire")];
    expect(
      (
        await run(
          [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, program, "--outfile", executable],
          cwd,
          bunEnv,
        )
      ).exitCode,
    ).toBe(0);

    const layouts = new Map<string, string>();
    for (const line of (await runTestaot("print", wire)).lines) {
      const [, layout, name] = /^layout (L\d+) .*?\bname="(Works|Clock|Sundial)"/.exec(line) ?? [];
      if (layout) layouts.set(name, layout);
    }
    const slots = new Map<string, string>();
    let layout = "";
    for (const line of (await runTestaot("plan", wire, "layouts", "exclude=CodeOutsideImage")).lines) {
      layout = /^layout (L\d+) /.exec(line)?.[1] ?? layout;
      if (/^\s+slot \d+ "works" /.test(line)) slots.set(layout, line.trim());
    }
    const [ofClock, ofSundial] = [slots.get(layouts.get("Clock")!)!, slots.get(layouts.get("Sundial")!)!];
    expect(/ offset=\d+/.exec(ofClock)![0]).toBe(/ offset=\d+/.exec(ofSundial)![0]);
    expect(ofClock).toEndWith(` type=undefined|null|${layouts.get("Works")}`);
    expect(ofSundial).not.toContain(" type=");
  },
);

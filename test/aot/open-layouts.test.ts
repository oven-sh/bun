import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, slot, spawned, unsupported } from "./harness/commands";

const program = `class Counter {
  count = 0;
  step(): number {
    this.count = this.count + 1;
    return this.count;
  }
}
const counter = new Counter();
console.log(counter.step());
delete (counter as any).count;
console.log(counter.step());
`;

const causeLine = /^aot: (unknown-code|unproven-type|mutation|limit): [a-z-]+ at /;

async function explain(family: string) {
  using folder = tempDir("aot-open-layouts", { "deleted-field.ts": program });
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", "--explain=" + family, "--outfile", "app", "deleted-field.ts"],
    String(folder),
    bunEnv,
  );
  built(build);
  return (build.stdout + build.stderr).split("\n").filter(line => causeLine.test(line));
}

describe.skipIf(!!unsupported)("compile/aot/open-layouts", () => {
  test(
    "--explain=mutation names the type whose field is deleted, and no other",
    () =>
      slot(async () => {
        expect(await explain("mutation")).toEqual([
          expect.stringMatching(
            /^aot: mutation: field-deleted at deleted-field\.ts:\d+:\d+, \d+ accesses, types 'Counter', /,
          ),
        ]);
      }),
    600_000,
  );

  test(
    "--explain=unknown-code lists only its own family",
    () =>
      slot(async () => {
        expect((await explain("unknown-code")).filter(line => !line.startsWith("aot: unknown-code: "))).toEqual([]);
      }),
    600_000,
  );
});

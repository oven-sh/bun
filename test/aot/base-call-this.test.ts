// `Base.call(this)` is how a constructor function entered its base before there were classes. Base has been constructed, or has
// methods on its prototype object, so it has its `prototype` property. That hides neither call nor apply: nothing of the idiom may
// go by name each round, whatever has made the property.
//
//   AOT_BASE_CALL=<text>    only the cases whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const whatHappenedToBase: Record<string, string> = {
  "nothing": ``,
  "its prototype object was read": `globalThis.seen = Base.prototype;`,
  "it got a method": `Base.prototype.get = function () { return this.count; };`,
  "it was constructed": `globalThis.seen = new Base();`,
  "it is the parent of the derived function": `Object.setPrototypeOf(Derived.prototype, Base.prototype); Object.setPrototypeOf(Derived, Base);`,
};

const waysIn: Record<string, string> = {
  call: `Base.call(this, x);`,
  apply: `Base.apply(this, [x]);`,
};

function program(event: string, wayIn: string) {
  return `
    function Base(x) { this.count = x; }
    function Derived(x) { ${wayIn} this.x = x; }
    ${event}
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let i = 0; i < rounds; i++) sum += new Derived(i).count;
    console.log(sum >= 0);
  `;
}

async function byNameEachRound(folder: string) {
  const executable = join(folder, isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-count-arrivals", "./main.mjs", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const counted = async (rounds: number) => {
    const path = join(folder, `counts-${rounds}`);
    const ran = await spawned([executable, String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    let byName = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, what] = line.split("\t");
      if (what?.startsWith("arrival:")) byName += Number(count);
    }
    return byName;
  };
  return Math.round(((await counted(4500)) - (await counted(500))) / 4000);
}

const only = process.env.AOT_BASE_CALL;

describe.concurrent("a constructor function enters its base without an access by name", () => {
  for (const [event, line] of Object.entries(whatHappenedToBase)) {
    for (const [way, wayIn] of Object.entries(waysIn)) {
      const name = `${way}: ${event}`;
      if (only && !name.includes(only)) continue;
      test(
        name,
        async () => {
          using dir = tempDir("aot-base-call-this", { "main.mjs": program(line, wayIn) });
          expect(await byNameEachRound(String(dir))).toBe(0);
        },
        240_000,
      );
    }
  }
});

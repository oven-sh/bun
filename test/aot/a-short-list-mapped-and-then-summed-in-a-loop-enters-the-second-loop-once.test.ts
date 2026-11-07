// `list.map(f).reduce(g, 0)` in a loop, where f writes the list it walks and g looks at the list it is given, so the two stay two loops.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const program = `
const turns = Number(process.env.TURNS ?? 1000);
const prices = [12, 7, 30, 5, 18, 2, 9, 11];
let total = 0;
for (let i = 0; i < turns; i++) {
  total =
    (total +
      prices
        .map((price, at) => {
          if (at === 1) prices[6] = i & 31;
          return price * (i & 3);
        })
        .reduce((sum, price, at, list) => sum + price + list.length, 0)) |
    0;
}
console.log(total, prices.join());
`;

test("what leaves either loop by a rare path goes on in a copy of the turn and joins nothing in front of the second loop", async () => {
  using dir = tempDir("aot-mapped-and-then-summed", { "main.ts": program, "tsconfig.json": "{}" });
  const folder = String(dir);
  const env = { ...bunEnv, NO_COLOR: "1" };
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "main.ts", "--outfile", "main"],
      folder,
      env,
    ),
  );
  const ran = await spawned(["./main"], folder, env);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout: "215856 12,7,30,5,18,2,7,11\n",
    exitCode: 0,
  });

  const printed = await printIR(folder, { until: "Select", functionName: "f0" });
  const likelyBlocks = printed.split("\n").filter(line => /^  b\d+\(.*\):$/.test(line));
  const position = "v\\d+: int\\[0, 4294967295\\]";
  expect(likelyBlocks.filter(line => line.includes(": Array<"))).toEqual([]);
  expect(likelyBlocks.filter(line => new RegExp(`\\(v\\d+: number, ${position}`).test(line))).toEqual([]);
  expect(likelyBlocks.filter(line => new RegExp(`\\(v\\d+: int\\|whole, ${position}\\):$`).test(line))).toHaveLength(1);
}, 120_000);

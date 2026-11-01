import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

interface Form {
  program: string;
  prints: string;
}

const forms: Record<string, Form> = {
  "at the top level": {
    program: `
const turns = Number(process.env.TURNS ?? 100);
const prices = [12.5, 7.25, 30, 5.5, 18, 2.75, 9, 11.5];
let total = 0;
for (let i = 0; i < turns; i++) {
  const taxed = prices.map(price => price * (1 + (i & 3) / 4));
  total += taxed[i & 7]! + taxed.length;
}
console.log(total);
`,
    prints: "2451.1875\n",
  },
  "in a function": {
    program: `
const turns = Number(process.env.TURNS ?? 100);
const prices = [12.5, 7.25, 30, 5.5, 18, 2.75, 9, 11.5];
function withTax(list: number[], rate: number): number[] {
  return list.map(price => price * rate);
}
let total = 0;
for (let i = 0; i < turns; i++) total += withTax(prices, 1 + (i & 3) / 4)[i & 7]!;
console.log(total);
`,
    prints: "1651.1875\n",
  },
  "in a method": {
    program: `
const turns = Number(process.env.TURNS ?? 100);
class Basket {
  prices = [12.5, 7.25, 30, 5.5, 18, 2.75, 9, 11.5];
  count(rate: number): number {
    const taxed = this.prices.map(price => price * rate);
    return taxed.length + taxed[3]!;
  }
}
const basket = new Basket();
let total = 0;
for (let i = 0; i < turns; i++) total += basket.count(1 + (i & 3) / 4);
console.log(total);
`,
    prints: "1556.25\n",
  },
  "in a field": {
    program: `
const turns = Number(process.env.TURNS ?? 100);
const prices = [12.5, 7.25, 30, 5.5, 18, 2.75, 9, 11.5];
class Bill {
  lines = prices.map(price => price * 2);
}
let total = 0;
for (let i = 0; i < turns; i++) total += new Bill().lines[i & 7]!;
console.log(total);
`,
    prints: "2426.5\n",
  },
};

for (const [form, { program, prints }] of Object.entries(forms)) {
  test(`a list mapped ${form}`, async () => {
    using dir = tempDir("aot-new-list-filled", { "main.ts": program, "tsconfig.json": "{}" });
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
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: prints, exitCode: 0 });

    const printed = await printIR(folder, { until: "Select" });
    const ofProgram = printed
      .split(/^(?=function f\d+ )/m)
      .filter(text => /^function f\d+ .*module=m0 /.test(text) && text.includes(" = NewArrayLike "));
    expect(ofProgram.length).toBeGreaterThan(0);
    for (const text of ofProgram) {
      const likely = text
        .split(/^(?=  b\d+\()/m)
        .filter(block => /^  b\d+\(.*\):$/m.test(block.split("\n")[0]!))
        .join("");
      const made = [...likely.matchAll(/^    (v\d+): \S+ = NewArrayLike (v\d+),/gm)];
      expect(made.length).toBeGreaterThan(0);
      for (const [, list, length] of made) {
        const stores = likely.split("\n").filter(line => line.includes(` = TryPutByValDirect ${list},`));
        expect(stores.length).toBeGreaterThan(0);
        expect(stores.filter(line => !line.includes(` length=${length} `))).toEqual([]);
      }
      const casts = new Set(made.map(([, list]) => list));
      for (const [, cast, from] of likely.matchAll(/^    (v\d+): .* = AssumeType (v\d+)[, ]/gm))
        if (casts.has(from!)) casts.add(cast!);
      const reads = [...likely.matchAll(/ = CallBuiltin (v\d+) overload=ArrayPrototypeLength\/0/g)].map(
        ([, list]) => list,
      );
      expect(reads.filter(list => casts.has(list!))).toEqual([]);
    }
  }, 120_000);
}

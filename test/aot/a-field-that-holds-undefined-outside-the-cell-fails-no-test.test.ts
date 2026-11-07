// A class with more fields than a cell holds keeps those outside the cell that few objects get a value for. Such a field takes no room while it holds `undefined`.
// A read of it answers `undefined` without a test that fails and without a lookup by name. The counts are exact: no clock and no machine decides them.
import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { slot } from "./harness/commands";
import { buildCounted, countScript, testsAddedByTheCompiler } from "./harness/counted-run";
import { test } from "./supported";

const numbers = Array.from({ length: 56 }, (_, index) => `a${index}`);
const items = Array.from({ length: 32 }, (_, index) => `u${index}`);

const files = {
  "rounds.ts": `
    class Item {
      weight: number;
      constructor(weight: number) {
        this.weight = weight;
      }
    }
    class Base {
      id: number;
      constructor(id: number) {
        this.id = id;
        this.start();
      }
      start(): void {}
    }
    class Holder extends Base {
      ${numbers.map(name => `${name}: number;`).join("\n      ")}
      ${items.map(name => `${name}: Item | undefined = undefined;`).join("\n      ")}
      start(): void {
        if (this.id < 0) fill(this, 1);
      }
      constructor(id: number) {
        super(id);
        ${numbers.map((name, index) => `this.${name} = id + ${index}.5;`).join("\n        ")}
      }
    }
    function fill(holder: Holder, weight: number): void {
      ${items.map(name => `holder.${name} = new Item(weight);`).join("\n      ")}
    }
    function weigh(holder: Holder): number {
      let sum = holder.a0;
      ${items.map(name => `const ${name} = holder.${name};\n      if (${name} !== undefined) sum += ${name}.weight;`).join("\n      ")}
      return sum;
    }
    // Whoever listens may do anything to the object it is handed.
    const filled = new Holder(1);
    fill(filled, 2);
    process.emit((process.env.EVENT ?? "nothing") as any, filled as any);
    let sum = weigh(filled);
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += weigh(new Holder(index & 7));
    console.log(sum > 0 && Object.keys(filled).length === ${numbers.length + items.length + 1} ? "ok" : "no");
  `,
};

test(
  "reads of fields that hold undefined and lie outside the cell",
  () =>
    slot(async () => {
      using dir = tempDir("aot-undefined-outside-the-cell", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.ts"), folder, "ok\n");
      const added = [...work.tests, ...work.uneven].filter(counted => testsAddedByTheCompiler.has(counted.kind));
      // A renamed test would count nothing.
      const testsOfSlots = added.filter(
        counted => counted.kind === "IsSlotFilled" && counted.functions.includes("weigh"),
      );
      expect(testsOfSlots.reduce((sum, counted) => sum + counted.executed, 0)).toBeGreaterThanOrEqual(items.length);
      expect(added.filter(counted => counted.failed).map(counted => `${counted.kind} ${counted.position}`)).toEqual([]);
      expect(work.accessesByName).toBe(0);
    }),
  300_000,
);

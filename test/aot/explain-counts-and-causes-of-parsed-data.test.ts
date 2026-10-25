// The page docs/bundler/aot-explain.mdx says what counts as a property access, and what an entry says of an object that JSON.parse has made.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function explain(text: string, ...flags: string[]) {
  using dir = tempDirWithBunTypes("aot-explain-counts", { "main.ts": text });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", ...flags, "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const lines = (stdout + stderr).split("\n");
  return { lines, exitCode, count: lines.find(line => line.includes("of property accesses are one load")) };
}

const items = (parsed: string) => `interface Item {
  sku: string;
  price: number;
}

const items: Item[] = [{ sku: "A-1", price: 2.5 }];
${parsed}
items.push(saved);

let total = 0;
for (const item of items) total += item.price;
console.log(total);
`;

describe.concurrent("what is counted", () => {
  test("the reads of `parse`, `push` and `log` are parts of calls of built-ins: `item.price` is the one access", async () => {
    const { count, exitCode } = await explain(items(`const saved: any = JSON.parse('{ "sku": "B-2", "price": 10 }');`));
    expect({ count, exitCode }).toEqual({
      count: "0% of property accesses are one load: 0 free, 1 tested, 0 by name (1)",
      exitCode: 0,
    });
  });

  test("a program that only calls built-ins has no access", async () => {
    const { count, exitCode } = await explain(
      `console.log(Math.max(1, 2), JSON.stringify([1]), [1, 2].map(n => n + 1).join());\n`,
    );
    expect({ count, exitCode }).toEqual({ count: undefined, exitCode: 0 });
  });
});

describe.concurrent("an object that JSON.parse has made reaches a type", () => {
  const program = items(`const saved: any = JSON.parse('{ "sku": "B-2", "price": 10 }');`);

  test("the cause is unknown-object, at the call, and the why is external-data", async () => {
    const { lines } = await explain(program, "--explain");
    expect(lines.filter(line => /^note: (1\.|why|fix|https)|^ +at /.test(line))).toEqual([
      "note: 1. unknown-object: An object from untyped code is used as this type here, so it can have any shape.",
      "   at main.ts:7:25",
      "note: why (external-data): The value comes from outside the program (JSON.parse, response.json(), structuredClone, a message).",
      "note: fix: build a new object of this type from it where it enters typed code.",
      "note: https://bun.com/docs/bundler/aot-explain#unknown-object",
    ]);
  });

  test("it belongs to the family unknown-code", async () => {
    const { lines } = await explain(program, "--explain=unknown-code");
    expect(lines.filter(line => line.startsWith("aot: "))).toEqual([
      "aot: unknown-code: unknown-object at main.ts:7:25, 1 access, 1 untyped operator, types 'Item', why external-data",
    ]);
    expect((await explain(program, "--explain=unproven-type")).lines.filter(line => line.startsWith("aot: "))).toEqual(
      [],
    );
  });

  test("an object literal of another shape behind a cast is no data from outside", async () => {
    const { lines } = await explain(
      items(`const saved = { sku: "B-2", price: 10, more: true, other: 1 } as any;`),
      "--explain=json",
    );
    const reasons = lines.filter(line => line.startsWith('{"rank"')).map(line => JSON.parse(line).reason);
    expect(reasons).not.toContain("unknown-object");
  });
});

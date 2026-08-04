// Generates a small "app": src/ modules that pull in zod, date-fns and lodash,
// plus N test files that each import the app barrel and run a handful of
// cheap assertions. Per-file cost is dominated by loading the module graph,
// which is the common shape for unit-test suites. The test files use global
// describe/test/expect so the identical suite runs under bun, vitest and jest.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = Number(process.argv[2] ?? 64);
const TESTS_PER_FILE = 8;
const ITEMS = Number(process.argv[3] ?? 200);
for (const [name, v, lo, hi] of [
  ["files", FILES, 1, 10_000],
  ["items", ITEMS, 2, 1_000_000],
] as const) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi)
    throw new Error(`${name} must be an integer in [${lo}, ${hi}], got ${v}`);
}
const MODULES = 24;
const root = import.meta.dir;

rmSync(root + "/src", { recursive: true, force: true });
rmSync(root + "/tests", { recursive: true, force: true });
rmSync(root + "/preload.ts", { force: true });
mkdirSync(root + "/src", { recursive: true });
mkdirSync(root + "/tests", { recursive: true });

for (let m = 0; m < MODULES; m++) {
  writeFileSync(
    `${root}/src/inventory${m}.ts`,
    `import { z } from "zod";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import groupBy from "lodash/groupBy";
import sortBy from "lodash/sortBy";

export const Item${m} = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  tags: z.array(z.string()).default([]),
  price: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Item${m} = z.infer<typeof Item${m}>;

export function make${m}(i: number): Item${m} {
  return Item${m}.parse({
    id: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
    name: "item-" + i,
    tags: i % 2 ? ["odd", "m${m}"] : ["even"],
    price: i * 1.5,
    createdAt: addDays(parseISO("2024-01-01T00:00:00Z"), i).toISOString(),
  });
}

export function summarize${m}(items: Item${m}[]) {
  const byTag = groupBy(items, it => it.tags[0]);
  const sorted = sortBy(items, it => -it.price);
  const spanDays = items.length
    ? differenceInCalendarDays(parseISO(items[items.length - 1].createdAt), parseISO(items[0].createdAt))
    : 0;
  return { tags: Object.keys(byTag).sort(), top: sorted[0]?.name ?? null, spanDays };
}
`,
  );
}

let barrel = "";
for (let m = 0; m < MODULES; m++) barrel += `export * from "./inventory${m}";\n`;
writeFileSync(`${root}/src/index.ts`, barrel);

for (let f = 0; f < FILES; f++) {
  const m = f % MODULES;
  let body = `import { Item${m}, make${m}, summarize${m} } from "../src";\n\n`;
  body += `describe("inventory${m} (file ${f})", () => {\n`;
  for (let t = 0; t < TESTS_PER_FILE; t++) {
    body += `  test("case ${t}", () => {
    const items = Array.from({ length: ${ITEMS + t} }, (_, i) => make${m}(i));
    const s = summarize${m}(items);
    expect(s.top).toBe("item-${ITEMS - 1 + t}");
    expect(s.spanDays).toBe(${ITEMS - 1 + t});
    expect(s.tags).toEqual(["even", "odd"]);
    expect(Item${m}.safeParse({ id: "nope" }).success).toBe(false);
    (expect(items[0]) as any).toBeItemNamed("item-0");
    expect((globalThis as any).__fixture).toBeDefined();
  });\n`;
  }
  body += `});\n`;
  writeFileSync(`${root}/tests/inventory${String(f).padStart(4, "0")}.test.ts`, body);
}

// A setup file every runner loads before each test file (bun --preload,
// jest setupFilesAfterEnv, vitest setupFiles): a custom matcher + a global hook.
writeFileSync(
  `${root}/preload.ts`,
  `import { make0 } from "./src";

expect.extend({
  toBeItemNamed(received: unknown, name: string) {
    const pass = typeof received === "object" && received !== null && (received as any).name === name;
    return { pass, message: () => \`expected \${JSON.stringify(received)} to be an item named \${name}\` };
  },
});

let made = 0;
beforeEach(() => {
  made++;
  (globalThis as any).__fixture = make0(made);
});
afterEach(() => {
  (globalThis as any).__fixture = undefined;
});
`,
);

console.log(`wrote ${MODULES} src modules, preload.ts and ${FILES} test files × ${TESTS_PER_FILE} tests to ${root}`);

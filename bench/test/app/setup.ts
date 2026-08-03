// Generates a JIT-heavy suite: FILES test files that each import a handful of
// real-world dependencies (zod, date-fns, lodash-es) and call into them enough
// times that JSC tiers the dependency functions up into DFG/FTL. Under
// `--isolate` with a fresh global per file, every file re-links every
// dependency module and re-tiers every hot function from scratch; the
// experimental reuse-global path keeps dependency module records alive so the
// optimized CodeBlocks survive.
//
// Usage:
//   bun bench/test/app/setup.ts
//   hyperfine --warmup 1 \
//     -n 'fresh global' 'bun test --isolate bench/test/app/suite' \
//     -n 'reuse global' 'BUN_FEATURE_FLAG_EXPERIMENTAL_TEST_ISOLATE_REUSE_GLOBAL=1 bun test --isolate bench/test/app/suite'
//
// To see JIT compile time directly:
//   BUN_JSC_reportTotalCompileTimes=1 bun test --isolate bench/test/app/suite
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = Number(process.env.FILES ?? 128);
const ITERS = Number(process.env.ITERS ?? 2000);
const root = import.meta.dir + "/suite";

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

// Shared project-side helper: lives outside node_modules so the reuse path
// still evicts it (project modules must always be fresh).
writeFileSync(
  `${root}/hot.ts`,
  `import { z } from "zod";
import { format, addDays, differenceInMilliseconds, parseISO } from "date-fns";
import { chunk, sortBy, uniqBy, groupBy, sumBy } from "lodash-es";

export const schema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(64),
  email: z.string().email(),
  tags: z.array(z.string()).max(8),
  createdAt: z.string(),
});
export type Row = z.infer<typeof schema>;

export function hot(iters: number) {
  const base = parseISO("2024-01-01T00:00:00.000Z");
  const rows: Row[] = [];
  for (let i = 0; i < 64; i++) {
    rows.push(
      schema.parse({
        id: i + 1,
        name: "user" + (i % 7),
        email: "u" + i + "@example.com",
        tags: ["t" + (i % 3), "t" + (i % 5)],
        createdAt: format(addDays(base, i % 30), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
      }),
    );
  }
  let acc = 0;
  for (let k = 0; k < iters; k++) {
    const grouped = groupBy(rows, r => r.name);
    const sorted = sortBy(rows, r => r.id);
    const uniq = uniqBy(rows, r => r.tags[0]);
    const chunks = chunk(sorted, 8);
    acc += sumBy(uniq, r => r.id);
    acc += chunks.length;
    acc += Object.keys(grouped).length;
    acc += differenceInMilliseconds(parseISO(rows[k & 63].createdAt), base) & 1023;
  }
  return acc;
}
`,
);

for (let f = 0; f < FILES; f++) {
  writeFileSync(
    `${root}/t${String(f).padStart(3, "0")}.test.ts`,
    `import { hot } from "./hot";
test("t${f}", () => {
  const v = hot(${ITERS});
  expect(typeof v).toBe("number");
  expect(v > 0).toBe(true);
});
`,
  );
}

console.log(`wrote ${root}/hot.ts + ${FILES} test files (ITERS=${ITERS})`);

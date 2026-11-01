import { expect } from "bun:test";
import { bunExe } from "harness";
import { readdirSync } from "node:fs";
import { test } from "../supported";
import { families, run, testFamily } from "./members";

test("every family has a test file", async () => {
  const written = await run(import.meta.dir, bunExe(), "members.fixture.ts", "--families");
  expect(JSON.parse(written.stdout)).toEqual([...families]);
  const files = readdirSync(import.meta.dir).filter(name => /^members-\d+\.test\.ts$/.test(name));
  expect(files.sort()).toEqual(families.map((_, index) => `members-${index + 1}.test.ts`));
});

await testFamily(1);

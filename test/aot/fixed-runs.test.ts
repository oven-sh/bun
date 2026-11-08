// harness/fixed-runs.ts says what lies in fixed-runs.
import { expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { folder } from "./harness/fixed-runs";
import { test } from "./supported";

test("each project has its test file", () => {
  const projects = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  expect(projects.filter(name => !existsSync(join(import.meta.dir, `fixed-runs-${name}.test.ts`)))).toEqual([]);
});

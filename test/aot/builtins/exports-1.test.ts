import { expect } from "bun:test";
import { readdirSync } from "node:fs";
import { test } from "../supported";
import { parts, testPart } from "./exports";

test("every part has a test file", () => {
  const files = readdirSync(import.meta.dir).filter(name => /^exports-\d+\.test\.ts$/.test(name));
  expect(files.sort()).toEqual(Array.from({ length: parts }, (_, index) => `exports-${index + 1}.test.ts`));
});

testPart(1);

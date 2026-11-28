import { beforeAll } from "bun:test";
import { createRequire } from "node:module";
beforeAll(() => {
  createRequire(import.meta.url)("./user.cjs");
});

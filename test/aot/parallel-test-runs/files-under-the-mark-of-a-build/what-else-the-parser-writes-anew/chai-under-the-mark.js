// @bun
import { assert } from "vitest";
export const found = typeof assert + " " + String(assert && assert.from);

import { assert } from "vitest";
import { sep } from "node:path";
module.exports = {
  check(value) {
    assert.ok(value);
    return sep;
  },
};

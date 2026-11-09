// The import stands on the third line.
const before = 1;
import { assert, vi } from "vitest";
module.exports = {
  check(value) {
    assert.ok(value);
  },
};

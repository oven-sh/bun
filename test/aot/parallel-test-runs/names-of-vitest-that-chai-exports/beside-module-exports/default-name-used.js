import vitest, { assert } from "vitest";
module.exports = {
  check(value) {
    assert.ok(value);
    return vitest;
  },
};

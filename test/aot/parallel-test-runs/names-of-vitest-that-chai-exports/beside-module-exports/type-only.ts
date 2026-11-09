import { assert } from "vitest";
type Assert = typeof assert;
module.exports = {
  check(_?: Assert) {
    return "checked";
  },
};

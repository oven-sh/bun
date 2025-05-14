import test from "ava";

import { sum } from "../index.js";

test("sum from native", t => {
  t.is(sum(1, 2), 3);
});

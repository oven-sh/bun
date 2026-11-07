import { test } from "vitest";
import helper from "./helper.cjs";
const own = name => ({ tag: "own", [name](value) { return [this === globalThis, this && this.tag, value].join(); } });
test("this", () => {
  console.log(helper.callHook(own("afterEach")), helper.callSuite(own("suite")), helper.callJest(own("jest")));
});

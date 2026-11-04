import { mock, test, vi } from "bun:test";
import * as inner from "./inner";
import * as one from "./one";
import * as two from "./two";

// Two mocks give a value in place of one object. They end as `bun test` itself ends them behind a test file: the latest first.
test("the value of the mock before answers again, and the object comes back behind the last", async () => {
  await mock.module("./one", () => ({ space: { v: "of one" }, name: "mock one" }));
  await mock.module("./two", () => ({ again: { v: "of two" }, name: "mock two" }));
  console.log("both are mocked:", one.space.v, two.again.v, inner.v);
  vi.doUnmock("./two");
  console.log("the latest has ended:", one.space.v, two.again.v, one.name, two.name, inner.v);
  vi.doUnmock("./one");
  console.log("both have ended:", one.space.v, two.again.v, one.name, two.name, inner.v);
});

import { test } from "bun:test";

test.todo("todo 1");
test.todo("todo 2", () => {
  throw new Error("it's not implemented yet");
});

// The evaluation has come by the statement that imports reader.ts.
import { test } from "bun:test";
import { read } from "./reader";
import { second } from "./second";
test("views", async () => {
  const later = await import("./later");
  console.log(second, read(), "|", later.seen());
});

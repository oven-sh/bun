// The evaluation stands in first.ts, and the statement that imports reader.ts is yet to come.
import { test } from "bun:test";
import { first } from "./first";
import { read } from "./reader";
test("views", async () => {
  const later = await import("./later");
  console.log(first, read(), "|", later.seen());
});

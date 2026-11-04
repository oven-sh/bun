// Nothing has come by reader.ts when the mock is laid.
import { test } from "bun:test";
import { mocker } from "./mocker";
import { held } from "./holder";
test("views", async () => {
  const later = await import("./later");
  console.log(mocker, held(), "|", later.seen());
});

// mocker.ts lays the mock between an importer that was passed and one whose body is yet to run.
import { test } from "bun:test";
import { read } from "./reader";
import { mocker } from "./mocker";
import { atLoad } from "./late";
test("views", async () => {
  const later = await import("./later");
  console.log(mocker, read(), atLoad, "|", later.seen());
});

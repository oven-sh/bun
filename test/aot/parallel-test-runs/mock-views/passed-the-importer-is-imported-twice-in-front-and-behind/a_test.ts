// 
import { test } from "bun:test";
import { read } from "./reader";
import { mocker } from "./mocker";
import { again } from "./again";
test("views", async () => {
  const later = await import("./later");
  console.log(mocker, read(), again(), "|", later.seen());
});

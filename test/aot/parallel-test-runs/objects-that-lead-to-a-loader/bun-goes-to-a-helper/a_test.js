// `Bun` is handed to a function.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(typeof take(Bun).version);
});

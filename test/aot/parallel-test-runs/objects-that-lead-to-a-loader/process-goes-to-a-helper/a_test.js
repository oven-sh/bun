// `process` is handed to a helper of another file, which reads what it holds.
import { test } from "bun:test";
import { platformOf } from "./helper.js";

const take = it => it;
test("t", () => {
  console.log(typeof platformOf(process), typeof take(process).pid);
});

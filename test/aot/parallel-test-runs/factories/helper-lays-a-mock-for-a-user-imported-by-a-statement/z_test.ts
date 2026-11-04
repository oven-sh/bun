import { test } from "bun:test";
import { read } from "./user";

test("file 3, without the helper", () => {
  console.log("file 3, without the helper:", read());
});

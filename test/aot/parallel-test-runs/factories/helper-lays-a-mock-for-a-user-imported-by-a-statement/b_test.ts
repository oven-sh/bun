import "./helper";
import { test } from "bun:test";
import { read } from "./user";

test("file 2", () => {
  console.log("file 2:", read());
});

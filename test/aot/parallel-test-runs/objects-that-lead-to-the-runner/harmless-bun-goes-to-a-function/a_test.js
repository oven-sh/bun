// `Bun` is handed to a function of the file.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  console.log("version", typeof take(Bun).version, typeof take(Bun).which);
  console.log("the reader gets", read());
});

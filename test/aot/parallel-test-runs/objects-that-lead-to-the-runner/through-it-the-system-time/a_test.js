// The runner is reached through the global object that was handed on, and sets the time.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  const jest = take(globalThis).Bun.jest(import.meta.path).jest;
  jest.useFakeTimers();
  jest.setSystemTime(new Date(86400000));
  console.log("now", Date.now(), new Date().getUTCDate());
  jest.useRealTimers();
  console.log("the reader gets", read());
});

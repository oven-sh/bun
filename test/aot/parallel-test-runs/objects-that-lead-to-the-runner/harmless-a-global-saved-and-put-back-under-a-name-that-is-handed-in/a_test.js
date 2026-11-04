// A helper saves a global under a name that it is handed, replaces it and puts it back.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const withGlobal = (name, value, run) => {
  const saved = globalThis[name];
  globalThis[name] = value;
  try {
    return run();
  } finally {
    globalThis[name] = saved;
  }
};

test("what the reader gets", async () => {
  console.log("under it", withGlobal("added", 3, () => globalThis.added), "behind it", globalThis.added);
  console.log("the reader gets", read());
});

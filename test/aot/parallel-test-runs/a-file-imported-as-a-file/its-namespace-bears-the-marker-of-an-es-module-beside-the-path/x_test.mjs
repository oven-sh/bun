import { test } from "bun:test";
import word, * as whole from "./pic.bin";
import * as note from "./note.txt" with { type: "file" };
test("x", async () => {
  const show = loaded => Object.keys(loaded).join() + " " + typeof loaded.default + " " + loaded.__esModule + " " + ("__esModule" in loaded);
  console.log("SAID", show(whole), word === whole.default, "|", show(note), "|", show(await import("./carried.json", { with: { type: "file" } })));
});

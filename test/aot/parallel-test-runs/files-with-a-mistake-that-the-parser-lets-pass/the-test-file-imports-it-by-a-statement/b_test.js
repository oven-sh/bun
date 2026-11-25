import { test } from "bun:test";
test("what the file in front has left", () => console.log(globalThis.ran?.join() ?? "nothing ran"));

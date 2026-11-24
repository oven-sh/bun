import { test, vi } from "vitest";
import { user } from "./user.mjs";
import { basename } from "node:path";
import first from "./one.mjs";
vi.mock("./target.mjs", () => {
  try {
    return { x: first + basename("/a/b") };
  } catch (error) {
    console.log("SAID", error.message);
    return { x: 0 };
  }
});
test("early use", () => console.log("SAID", user(), typeof first + basename("/a/b")));

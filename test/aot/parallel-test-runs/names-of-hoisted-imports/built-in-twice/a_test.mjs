import { test, vi } from "vitest";
import { user } from "./user.mjs";
import { basename } from "node:path";
import { basename as second } from "node:path";
vi.mock("./target.mjs", () => {
  try {
    return { x: second("/a/b") + basename("/c") };
  } catch (error) {
    console.log("SAID", error.message);
    return { x: 0 };
  }
});
test("early use", () => console.log("SAID", user(), typeof second("/a/b") + basename("/c")));

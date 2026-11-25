import { test, vi } from "vitest";
import { user } from "./user.mjs";
import * as all from "./two-parts.mjs";
vi.mock("./target.mjs", () => {
  try {
    return { x: all.two() };
  } catch (error) {
    console.log("SAID", error.message);
    return { x: 0 };
  }
});
test("early use", () => console.log("SAID", user(), typeof all.two()));

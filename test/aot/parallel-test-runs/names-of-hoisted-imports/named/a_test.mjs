import { test, vi } from "vitest";
import { user } from "./user.mjs";
import { one } from "./one.mjs";
import { two } from "./two-parts.mjs";
vi.mock("./target.mjs", () => {
  try {
    return { x: two() + one };
  } catch (error) {
    console.log("SAID", error.message);
    return { x: 0 };
  }
});
test("early use", () => console.log("SAID", user(), typeof two() + one));

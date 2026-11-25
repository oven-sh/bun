import { test, vi } from "vitest";
import { user } from "./user.mjs";
import { deep } from "./nested/index.mjs";
vi.mock("./target.mjs", () => {
  try {
    return { x: deep() };
  } catch (error) {
    console.log("SAID", error.message);
    return { x: 0 };
  }
});
test("early use", () => console.log("SAID", user(), typeof deep()));

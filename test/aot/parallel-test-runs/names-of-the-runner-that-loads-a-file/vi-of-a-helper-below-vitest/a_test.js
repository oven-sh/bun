import { test, vi } from "vitest";
import { own, fakes } from "./helper.js";
test("vi", () => {
  console.log(own() === vi, fakes());
});

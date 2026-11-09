import { test } from "bun:test";
import { load } from "./deep/loader.js";
function actual() {
  return jest.requireActual("./beside.cjs");
}
const arrow = () => jest.requireActual("./beside.cjs");
const chosen = (first) => (first ? jest.requireActual("./beside.cjs") : jest.requireMock("./beside.cjs"));
test("whose folder", () => {
  console.log(load(actual), "|", load(arrow), "|", load(() => chosen(true)), "|", load(() => chosen(false)));
});

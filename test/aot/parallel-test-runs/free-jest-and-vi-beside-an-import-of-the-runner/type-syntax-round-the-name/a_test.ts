import { test } from "bun:test";
import { load } from "./deep/loader.js";
const actual = () => (jest as any).requireActual("./beside.cjs");
const sure = () => jest!.requireActual("./beside.cjs");
function typed(): { where: string } {
  return jest.requireActual("./beside.cjs") as { where: string };
}
test("whose folder", () => {
  console.log(load(actual), "|", load(sure), "|", load(typed));
});

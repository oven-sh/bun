import { jest, vi, test } from "bun:test";
import { load, loadLater } from "./loader.js";
const alias = jest;
const other = vi;
const actual = () => alias.requireActual("./beside.cjs");
const later = () => other.importActual("./beside.cjs");
function declared() {
  const got = alias.requireActual("./beside.cjs");
  return got;
}
test("whose folder", async () => {
  console.log(load(actual), "|", load(declared), "|", await loadLater(later));
});

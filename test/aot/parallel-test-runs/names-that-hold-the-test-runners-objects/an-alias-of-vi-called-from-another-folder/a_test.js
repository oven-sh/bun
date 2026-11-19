import { vi, test } from "bun:test";
import { loadLater } from "./deep/loader.js";
const alias = vi;
const actual = () => alias.importActual("./beside.cjs");
const named = () => vi.importActual("./beside.cjs");
test("whose folder", async () => {
  console.log(await loadLater(actual), "|", await loadLater(named));
});

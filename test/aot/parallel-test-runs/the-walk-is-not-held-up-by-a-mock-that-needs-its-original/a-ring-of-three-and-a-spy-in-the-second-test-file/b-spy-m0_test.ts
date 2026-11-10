import { jest, test, vi } from "bun:test";
import { order } from "./log";
vi.mock("./m0", { spy: true });
import "./m0";
test("loads", async () => {
  const mocked = await import("./m0");
  const importer = await import("./m2");
  const actual = await vi.importActual("./m0");
  console.log("SAID spy-m0", String(importer.seesNext()), mocked.name, String(mocked.fn()), vi.isMockFunction(mocked.fn), "&", actual.name, actual.fn(), vi.isMockFunction(actual.fn), String(actual.seesNext()));
});

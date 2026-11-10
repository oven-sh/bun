import { jest, test, vi } from "bun:test";
import { order } from "./log";
jest.mock("./m0", () => { order.push("factory"); return { ...jest.requireActual("./m0"), name: "mock" }; });
import "./m0";
test("loads", async () => {
  const mocked = await import("./m0");
  const importer = await import("./m2");
  console.log("SAID", String(order), "|", String(importer.seesNext()), mocked.name, mocked.fn());
});

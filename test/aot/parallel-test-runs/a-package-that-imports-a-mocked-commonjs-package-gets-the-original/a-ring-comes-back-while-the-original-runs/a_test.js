import { test, vi, jest, mock } from "bun:test";
import { seen } from "reads";
vi.mock("dep", () => ({ value: () => "mocked", early: "mocked-early", atLoad: "of-mock" }));
test("t", async () => { console.log("SAID", seen(), (await import("dep")).value()); });

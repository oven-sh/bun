import { test, vi } from "vitest";
import { get } from "./part.mjs";
vi.mock("./part.mjs", () => ({ get: () => 0 }));
const tools = { vi };
test("t", async () => console.log("SAID", get(), (await tools.vi.importActual("./part.mjs")).get()));

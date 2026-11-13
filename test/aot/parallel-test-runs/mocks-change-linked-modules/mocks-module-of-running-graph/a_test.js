import { it, vi } from "vitest";
import { launch } from "./support.js";
vi.mock("./bee.js", async importOriginal => { const actual = await importOriginal(); return { ...actual, bee: () => "mocked " + actual.bee() }; });
it("a", () => console.log("|", launch()));

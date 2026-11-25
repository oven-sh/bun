import { test, vi } from "vitest";
import { order } from "./log.mjs";
import { a } from "./a.mjs";
vi.mock("./part.mjs", async importOriginal => { const original = await importOriginal(); order.push("factory part " + original.sees()); return { ...original, part: "mock " + original.part }; });
vi.mock("./other.mjs", async () => { const original = await vi.importActual("./other.mjs"); order.push("factory other " + original.sees()); return { ...original, other: "mock " + original.other }; });
test("t", () => console.log("SAID", a(), order.join(" ")));

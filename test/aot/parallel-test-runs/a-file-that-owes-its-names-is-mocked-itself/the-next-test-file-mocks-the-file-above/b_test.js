import { test, vi } from "bun:test";
vi.mock("./last.mjs", () => ({ extra: 7 }));
import { look } from "./user.mjs";
test("made up", () => console.log("SAID next file", look()));

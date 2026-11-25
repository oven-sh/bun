import { it, vi } from "bun:test";
import * as near from "./near.mjs";
vi.mock("./near.mjs", { spy: true });
it("reads what the original imports", () => console.log("SAID", near.read(), vi.isMockFunction(near.read)));

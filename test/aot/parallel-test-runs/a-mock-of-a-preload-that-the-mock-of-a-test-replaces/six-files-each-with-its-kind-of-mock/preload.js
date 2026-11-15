import { vi } from "bun:test";
import { viaHelper } from "./helper.js";
vi.mock("./dep.js", () => ({ who: "preload", other: "preload other" }));

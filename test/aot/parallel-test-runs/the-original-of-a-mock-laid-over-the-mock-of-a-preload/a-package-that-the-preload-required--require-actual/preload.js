import { vi } from "bun:test";
vi.mock("widget", () => ({ who: "standing", other: "standing other" }));
require("widget");

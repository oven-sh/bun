import { mock, test, vi } from "bun:test";
import { user } from "./user.mjs";
vi.mock("node:os", () => ({ platform: () => "mocked" }));
test("c", () => console.log("c", user()));

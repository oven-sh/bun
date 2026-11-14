import { test, vi } from "bun:test";
import { leaf } from "./leaf.mjs";
vi.mock("./leaf.mjs", () => ({ leaf: () => "mocked" }));
test("b", () => { console.log("SAID b", leaf()); });

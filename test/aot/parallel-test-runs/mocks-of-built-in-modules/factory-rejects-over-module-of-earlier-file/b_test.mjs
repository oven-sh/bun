import { test, vi } from "bun:test";
import { top } from "./top.mjs";
vi.mock("node:os", () => Promise.reject(new Error("no mock")));
test("b", () => console.log("SAID b", top()));

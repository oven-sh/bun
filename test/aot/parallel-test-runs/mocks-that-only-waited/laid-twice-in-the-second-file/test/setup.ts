import { vi } from "bun:test";

vi.mock("lib", () => ({ price: () => "the set-up's" }));

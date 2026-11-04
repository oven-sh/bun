import { vi } from "bun:test";
import "./inner";

vi.doMock("./rate", () => ({ rate: "mock rate" }));

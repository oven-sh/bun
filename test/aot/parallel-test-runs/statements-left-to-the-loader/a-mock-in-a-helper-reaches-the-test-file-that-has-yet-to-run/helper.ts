import { vi } from "bun:test";
import "./tax";
vi.doMock("./tax", () => ({ rate: () => 2 }));

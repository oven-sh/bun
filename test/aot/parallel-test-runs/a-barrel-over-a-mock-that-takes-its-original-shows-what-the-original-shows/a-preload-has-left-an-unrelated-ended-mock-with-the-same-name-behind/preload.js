import { vi } from "bun:test";
vi.doMock("./extra.js", () => ({ z: 1, spare: 1 }));
await import("./uses-extra.js");
vi.doUnmock("./extra.js");

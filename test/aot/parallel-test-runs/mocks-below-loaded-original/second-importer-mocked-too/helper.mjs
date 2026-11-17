import { vi } from "vitest";
vi.mock("./other.mjs", async () => ({ other: () => "mocked other" }));

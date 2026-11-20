import { vi } from "bun:test";
vi.mock("./tax", () => ({ rate: 1, label: "mock", round: () => "mock", Tax: class Mock {} }));

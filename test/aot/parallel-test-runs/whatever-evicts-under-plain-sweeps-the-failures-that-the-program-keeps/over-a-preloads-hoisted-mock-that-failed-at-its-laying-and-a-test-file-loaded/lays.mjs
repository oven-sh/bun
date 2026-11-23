import { vi } from "bun:test";
vi.mock("./tray.mjs", () => ({ o: word }));
const word = "preload tray";

import { vi, mock, jest } from "bun:test";
jest.mock("./tray.mjs", () => ({ o: "preload tray" }));

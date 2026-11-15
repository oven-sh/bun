import { jest } from "bun:test";
export const mocked = "mock";
jest.mock("./settings.json", () => ({ name: "mock" }));

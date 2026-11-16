import { jest } from "bun:test";
jest.mock("./menu.ts", () => ({ ...jest.requireActual<any>("./menu.ts"), dish: () => "set menu" }));

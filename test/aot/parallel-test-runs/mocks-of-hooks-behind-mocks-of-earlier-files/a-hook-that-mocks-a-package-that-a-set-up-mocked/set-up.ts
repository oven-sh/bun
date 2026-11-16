import { jest } from "bun:test";
jest.mock("menu-of-the-day", () => ({ ...jest.requireActual<any>("menu-of-the-day"), dish: () => "set menu" }));

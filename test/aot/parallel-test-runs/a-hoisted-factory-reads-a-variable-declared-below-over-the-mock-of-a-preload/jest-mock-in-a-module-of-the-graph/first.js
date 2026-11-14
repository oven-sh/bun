import { vi, jest } from "bun:test";
jest.mock("./dep.js", () => ({ who: name }));
const name = "later";

import { vi, jest } from "bun:test";
vi.mock("./dep.js", () => ({ who: name }));
const name = "later";

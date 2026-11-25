import { test, vi, jest } from "bun:test";
import "./importer";
jest.mock("./dep");
test("runs", async () => { console.log("test"); });

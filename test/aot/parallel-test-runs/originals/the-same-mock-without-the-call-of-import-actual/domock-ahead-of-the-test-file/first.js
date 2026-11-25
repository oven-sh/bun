import { vi } from "bun:test";
import { who } from "./m.js";
console.log("first runs", who);
vi.doMock("./m.js", () => {
  console.log("factory runs");
  return { who: "mock", count: () => "mock" };
});

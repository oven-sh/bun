import { test, vi } from "bun:test";
import * as reader from "./reader.cjs";
vi.mock("./store.ts", () => ({ get: () => "mocked", put: () => "mocked put" }));
test("imports a service above the file", async () => {
  console.log(reader.read());
  const service: any = await import("./service.ts");
  console.log(service.load(), reader.read());
});

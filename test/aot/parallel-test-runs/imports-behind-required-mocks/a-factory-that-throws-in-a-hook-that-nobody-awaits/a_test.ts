import { beforeEach, mock, test, vi } from "bun:test";
import * as reader from "./reader.cjs";
vi.mock("./store.ts", () => ({ get: () => "mocked", put: () => "mocked put" }));
beforeEach(() => {
  mock.module("./store.ts", async () => {
    await vi.importActual<any>("./store.ts");
    throw new Error("the factory");
  });
});
test("imports a service above a file whose mock fails", async () => {
  console.log(reader.read());
  try {
    const service: any = await import("./service.ts");
    console.log(service.load());
  } catch (error: any) {
    console.log("caught", error.message);
  }
});

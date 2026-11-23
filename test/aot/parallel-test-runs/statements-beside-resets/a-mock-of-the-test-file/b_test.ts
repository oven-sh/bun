import { jest, mock, test } from "bun:test";
const api: any = await import("./api.mjs");
import * as page from "./page.ts";
import * as service from "./svc.ts";
mock.module("./api.mjs", () => ({ ...jest.requireActual<any>("./api.mjs"), get: () => "test" }));

test("shows", () => {
  console.log("b", api.get(), page.show(), service.load());
});

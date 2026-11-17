import { expect, mock, test } from "bun:test";
import { notify } from "./service.ts";

const send = mock(() => "mocked");
mock.module("./barrel.ts", () => ({ send }));

test("the service calls the mock", () => {
  console.log("b", notify());
  expect(send).toHaveBeenCalledTimes(1);
});

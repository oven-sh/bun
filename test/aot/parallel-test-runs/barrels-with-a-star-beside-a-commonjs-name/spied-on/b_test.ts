import { expect, spyOn, test } from "bun:test";
import * as barrel from "./barrel.ts";

test("calls the spy", () => {
  const send = spyOn(barrel, "send").mockImplementation(() => "spied");
  console.log("b", barrel.send());
  expect(send).toHaveBeenCalledTimes(1);
  send.mockRestore();
  console.log("b", barrel.send());
});

import { expect, test, vi } from "bun:test";
import * as mail from "./mail.cjs";

test("spied on", () => {
  const spy = vi.spyOn(mail, "get").mockReturnValue("spied");
  console.log("spied on", mail.get());
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  console.log("restored", mail.get());
});

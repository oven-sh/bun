import { spyOn, test } from "bun:test";
import * as mail from "./mail.cjs";

test("next file", () => {
  console.log("next file", mail.get());
  using spy = spyOn(mail, "get").mockReturnValue("spied");
  console.log("next file", mail.get(), spy.mock.calls.length);
});

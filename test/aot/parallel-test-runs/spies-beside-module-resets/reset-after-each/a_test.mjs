import { afterEach, jest, test } from "bun:test";
import * as mail from "./mail.cjs";

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

test("spied on", () => {
  jest.spyOn(mail, "get").mockImplementation(() => "spied");
  console.log("spied on", mail.get(), mail.limit);
});

test("restored", () => {
  console.log("restored", mail.get(), mail.limit);
});

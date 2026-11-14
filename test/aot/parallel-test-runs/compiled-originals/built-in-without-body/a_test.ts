import { test, vi } from "bun:test";
import { read, isDeepStrictEqual } from "./low";
vi.mock("./low", async original => ({ ...(await original<any>()), added: 1 }));
test("an original without a body reads the names of a built-in module that nobody else loads", () => {
  console.log("SAID", read(), isDeepStrictEqual([1], [1]));
});

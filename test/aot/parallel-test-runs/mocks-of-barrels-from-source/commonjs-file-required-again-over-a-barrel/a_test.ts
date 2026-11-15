import { mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
import { greet } from "./dep.cjs";
import { viaUser } from "./user.ts";

const ask = createRequire(import.meta.url);

test("a file below a mocked barrel is required again", async () => {
  await import("./barrel.ts");
  delete ask.cache[ask.resolve("./barrel.ts")];
  const barrel: any = await import("./barrel.ts");
  mock.module("./barrel.ts", () => ({ greet: () => "mock" }));
  delete ask.cache[ask.resolve("./dep.cjs")];
  console.log("required", ask("./dep.cjs").greet());
  const actual: any = await vi.importActual("./barrel.ts");
  console.log("actual", actual.greet());
  vi.doUnmock("./barrel.ts");
  console.log("ended", barrel.greet(), greet(), viaUser());
});

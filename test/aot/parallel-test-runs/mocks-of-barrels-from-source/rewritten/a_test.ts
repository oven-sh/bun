import { mock, test, vi } from "bun:test";
import { join } from "node:path";
import { app } from "./app";
import { greet as direct } from "./dep";

test("a file that the test writes is mocked", async () => {
  const path = join(import.meta.dir, "bar" + "rel.ts");
  await Bun.write(path, `export { greet } from "./dep";\nexport const own = "own";\n`);
  const barrel: any = await import(path);
  console.log("loaded", barrel.greet(), barrel.own, direct());
  mock.module(path, () => ({ greet: () => "mocked", own: "mocked own" }));
  console.log("mocked", barrel.greet(), barrel.own, direct(), app());
  vi.doUnmock(path);
  console.log("unmocked", barrel.greet(), barrel.own, direct(), app());
});

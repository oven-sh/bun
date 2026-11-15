import { test, vi, jest, mock } from "bun:test";
enum Names { Other = "./other" }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    const load = (Names: any) => vi.importActual(Names.Other);
    await load({ Other: "./other" });
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});

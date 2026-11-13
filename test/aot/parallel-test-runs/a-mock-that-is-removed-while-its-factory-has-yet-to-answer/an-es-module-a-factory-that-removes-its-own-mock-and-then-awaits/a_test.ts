import { test, vi } from "bun:test";
test("the import that called the factory waits for it", async () => {
  const heard: string[] = [];
  const gate = Promise.withResolvers<void>();
  vi.doMock("./kept", async () => {
    vi.doUnmock("./kept");
    heard.push("factory begins");
    await gate.promise;
    heard.push("factory ends");
    return { x: "mock" };
  });
  const loading = import("./kept").then(kept => { heard.push("import has " + kept.x); });
  for (let turn = 0; turn < 50; turn++) await 0;
  heard.push("gate opens");
  gate.resolve();
  await loading;
  console.log("SAID " + heard.join(" | "));
});

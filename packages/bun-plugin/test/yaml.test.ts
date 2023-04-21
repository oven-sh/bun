import { test, expect } from "bun:test";
import { YamlPlugin } from "..";

test("yaml loader - no plugin", async () => {
  expect(async () => {
    await import("./data.yml");
  }).toThrow();
});

test("yaml loader", async () => {
  const plugin = YamlPlugin();
  Bun.plugin(plugin);
  const mod = await import("./data.yml");

  // {
  //   doe: "a deer, a female deer",
  //   ray: "a drop of golden sun",
  //   pi: 3.14159,
  // }
  expect(mod.doe).toEqual("a deer, a female deer");
  expect(mod.ray).toEqual("a drop of golden sun");
  expect(mod.pi).toEqual(3.14159);

  Bun.plugin.clearAll();
});

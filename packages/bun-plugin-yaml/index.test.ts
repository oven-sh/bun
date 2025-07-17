import { expect, test } from "bun:test";
import YamlPlugin from ".";

test("yaml loader - no plugin", async () => {
  expect(async () => {
    await import("./data.yml");
  }).toThrow();
});

test("yaml loader", async () => {
  const plugin = YamlPlugin();
  Bun.plugin(plugin);
  const { default: mod } = await import("./data.yml");

  expect(mod.doe).toEqual("a deer, a female deer");
  expect(mod.ray).toEqual("a drop of golden sun");
  expect(mod.pi).toEqual(3.14159);

  Bun.plugin.clearAll();
});

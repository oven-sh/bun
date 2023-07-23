import { afterEach, expect, test } from "bun:test";
import { LightningCSSPlugin } from "../plugin";

afterEach(() => {
  Bun.plugin.clearAll();
});

test("can import css", async () => {
  Bun.plugin(LightningCSSPlugin());

  const css = await import("./cases/css/index.css");
  console.log(css);
});

test("can import css modules", async () => {
  Bun.plugin(LightningCSSPlugin());

  const css = await import("./cases/css-modules/test.module.css");
  expect(css.test).not.toBe(undefined);
});

test("bundles css imports", async () => {
  Bun.plugin(LightningCSSPlugin());

  const css = await import("./cases/with-imports/index.css");
  console.log(css);
});

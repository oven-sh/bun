// @ts-nocheck
import { test } from "bun:test";
const flag = process.argv.length > 99;
const made = ["bun:pa", "th"].join("");
const say = async load => {
  try {
    const it = await load();
    console.log(typeof it === "string" ? it : typeof it.join);
  } catch (error) {
    console.log(error.code);
  }
};
test("one name", async () => {
  await say(() => require("bun:path"));
  await say(() => import("bun:path"));
  await say(() => import("bun:path", { with: {} }));
  await say(() => require.resolve("bun:path"));
  await say(() => import.meta.resolve("bun:path"));
  await say(() => import("./equals.ts").then(it => it.default));
  await say(() => require("bun:os"));
});
test("a choice", async () => {
  await say(() => require(flag ? "bun:path" : "bun:os"));
  await say(() => import(flag ? "bun:path" : "bun:os"));
  await say(() => import(flag ? "bun:path" : "bun:os", { with: {} }));
  await say(() => require.resolve(flag ? "bun:path" : "bun:os"));
});
test("a name that is made", async () => {
  await say(() => require(made));
  await say(() => require(flag ? "bun:path" : made));
});

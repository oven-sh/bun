import { test, vi } from "bun:test";
const say = async load => {
  try {
    return (await load()).look();
  } catch (error) {
    return error.constructor.name;
  }
};
test("t", async () => {
  vi.doMock("./tints.mjs", async original => ({ hue: 5 }));
  console.log("SAID", await say(() => import("./user.mjs")));
});

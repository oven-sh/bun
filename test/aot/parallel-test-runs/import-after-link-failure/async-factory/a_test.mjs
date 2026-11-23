import { test, vi } from "bun:test";
const show = all => Object.keys(all).sort().map(key => key + "=" + all[key]).join();
const load = name => import(name).then(show, error => error.name);
test("the barrel", async () => {
  console.log("SAID user", await load("./user.mjs"));
  vi.doMock("./dep.mjs", async () => {
    for (let turn = 0; turn < 6; turn++) await 0;
    return { a: "mocked" };
  });
  console.log("SAID barrel", await load("./barrel.mjs"));
  console.log("SAID dep", await load("./dep.mjs"));
});

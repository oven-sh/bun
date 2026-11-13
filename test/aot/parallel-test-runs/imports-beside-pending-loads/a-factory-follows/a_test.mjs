import { jest, mock, test, vi } from "bun:test";
const tried = async load => { try { return (await load()).seen(); } catch (error) { return "threw " + error.name; } };
const rest = time => new Promise(done => setTimeout(done, time));
const turns = async () => { for (let i = 0; i < 20; i++) await 0; };
test("a", async () => {
  vi.doMock("./dep.mjs", async () => { await 0; console.log("settles"); return { flag: "first" }; });
  console.log("one", await tried(() => require("./user.mjs")));
  vi.doMock("./dep.mjs", () => ({ flag: "second" }));
  console.log("two", await tried(() => import("./user.mjs")));
  await turns();
  console.log("turns");
  await rest(15);
  console.log("three", await tried(() => import("./user.mjs")));
});

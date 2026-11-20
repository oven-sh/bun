import { test, vi } from "bun:test";
const tried = async load => { try { return await load(); } catch (error) { return { look: () => error.name }; } };
const say = (at, reader) => console.log("SAID", at, reader.look());
test("t", async () => {
  vi.doMock("./shapes.mjs", original => ({ square: 30 }));
  vi.doMock("./tints.mjs", original => ({ blue: 30 }));
  const old = await tried(() => import("./user.mjs"));
  say("under", old);
  say("fresh", await tried(() => import("./fresh.mjs")));
});

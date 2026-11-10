import { test, vi, mock } from "bun:test";
const read = it => { try { return String(it.early); } catch (error) { return "threw " + error.name; } };
const settle = async it => { try { return read(await it); } catch (error) { return "rejected " + error.name; } };
const seen = async it => { try { return String((await it).seen()); } catch (error) { return "threw " + error.name; } };
const M = "./module.mjs";
test("t", async () => {
  console.log("SAID real", await settle(import(M)));
  vi.doMock(M, () => ({ early: "mock 1" }));
  const one = await import(M);
  console.log("SAID one", read(one));
  const third = import(M);
  vi.doUnmock(M);
  console.log("SAID third", await settle(third), "| held", read(one), "| ran", globalThis.ran ?? 0);
}, 9000);
